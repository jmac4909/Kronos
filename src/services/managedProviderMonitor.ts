import * as crypto from 'crypto';
import type { KronosState as KronosStateSnapshot } from '../state/types';
import {
  configuredGitLabProjectPathFromMergeRequestUrl,
  gitlabRestClient,
  type GitLabMergeRequestMonitorSnapshot,
} from './gitlabRestClient';
import { jenkinsRestClient, type JenkinsBuildContext } from './jenkinsRestClient';
import { isSonarRestConfigured, sonarDashboardUrl, sonarRestClient, type SonarBranchContext } from './sonarRestClient';
import {
  compareGitLabPipelineDigests,
  mergeGitLabPipelineDigest,
  normalizeGitLabPipelineDigest,
  type GitLabPipelineDigest,
  type GitLabPipelineTransition,
} from './pipelineTransitions';
import {
  gitLabPipelineMonitorSnapshotPath,
  readGitLabPipelineMonitorSnapshot,
  writeGitLabPipelineMonitorSnapshot,
} from './gitlabPipelineMonitorStore';
import {
  compareGitLabMergeRequestDigests,
  gitLabMergeRequestNeedsAttention,
  mergeGitLabMergeRequestDigest,
  normalizeGitLabMergeRequestDigest,
  type GitLabMergeRequestDigest,
  type GitLabMergeRequestTransition,
  type GitLabMergeRequestTransitionKind,
} from './gitlabMergeRequestTransitions';
import {
  advanceGitLabMergeRequestReadStatus,
  gitLabMergeRequestMonitorSnapshotPath,
  gitLabMergeRequestReadStatusPath,
  readGitLabMergeRequestMonitorSnapshot,
  readGitLabMergeRequestReadStatus,
  writeGitLabMergeRequestMonitorSnapshot,
  writeGitLabMergeRequestReadStatus,
  type GitLabMergeRequestReadStatus,
  type GitLabMergeRequestReadStatusInput,
} from './gitlabMergeRequestMonitorStore';
import {
  buildCiMonitorDigest,
  compareCiMonitorDigests,
  mergeCiMonitorDigest,
  normalizeCiMonitorDigest,
  type CiMonitorDigest,
  type CiMonitorTransition,
} from './ciTransitions';
import { ciMonitorSnapshotPath, readCiMonitorSnapshot, writeCiMonitorSnapshot } from './ciMonitorStore';
import {
  appendMonitorEvent,
  listMonitorEvents,
  readMonitorEvent,
  type MonitorEvent,
  type MonitorEventSource,
  type MonitorEventSubject,
} from './monitorEventStore';
import { tryAcquireManagedMonitorLease } from './managedMonitorLease';
import {
  listWorkSessions,
  addWorkSessionProviderBinding,
  newestWorkSessionProviderBinding,
  recordWorkSessionMonitoringResult,
  type AddWorkSessionProviderBindingInput,
  type WorkSessionRecord,
} from './workSessionStore';
import { optionalTrimmedStringFromUnknown } from './records';
import { unknownErrorMessage } from './errorUtils';
import { projectConfigurationForTicket, readProjectGitBranch } from './projectCatalog';
import { effectiveTicketMergeRequest, latestGitLabMergeRequestBinding } from './ticketMergeRequestProjection';
import { isProviderReadTransitionKind, providerReadStateSignature } from './providerReadTransitions';

export interface ManagedProviderPollResult {
  polled: number;
  transitions: number;
  failures: number;
  skipped: number;
  leaseUnavailable: boolean;
  leaseReason?: string;
}

export interface ManagedProviderNotice {
  event: MonitorEvent;
  session: MonitoredWorkSessionRecord;
  severity: 'warning' | 'information';
  providerUrl?: string;
  contextCommand?: 'kronos.insertGitLabContext' | 'kronos.insertCiContext';
}

export interface ConfiguredGitLabPollingTarget {
  iid: number;
  projectIdOrPath: string;
  providerUrl?: string;
}

export interface ConfiguredCiPollingTargets {
  jenkinsUrl?: string;
  sonar?: { projectKey: string; branch: string; providerUrl?: string };
}

export interface ManagedProviderMonitorOptions {
  state: () => KronosStateSnapshot | null;
  log?: (message: string, detail?: string) => void;
  notify?: (notice: ManagedProviderNotice) => void;
  refresh?: () => void;
  projectTicketProviderState?: (
    ticketKey: string,
    input: { mr?: NonNullable<KronosStateSnapshot['tickets'][string]['mr']>; build?: NonNullable<KronosStateSnapshot['tickets'][string]['build']> },
  ) => void;
  updateProjectSonarTarget?: (projectName: string, projectKey: string, branch?: string) => void;
}

const LEASE_RENEWAL_MS = 60 * 1000;
const FAILURE_PIPELINE_STATUSES = new Set(['failed', 'failure', 'error', 'canceled', 'cancelled']);
const FAILURE_BUILD_STATUSES = new Set(['failed', 'failure', 'error', 'unstable', 'aborted']);
const PASSING_SONAR_GATES = new Set(['ok', 'pass', 'passed', 'success']);
type MonitoredWorkSessionRecord = WorkSessionRecord & { ticketKey: string };
type TicketWorkSessionRecord = MonitoredWorkSessionRecord;

export class ManagedProviderMonitor {
  private inFlight: Promise<ManagedProviderPollResult> | undefined;

  constructor(private readonly options: ManagedProviderMonitorOptions) {}

  poll(): Promise<ManagedProviderPollResult> {
    if (this.inFlight) { return this.inFlight; }
    const current = this.pollOnce().finally(() => {
      if (this.inFlight === current) { this.inFlight = undefined; }
    });
    this.inFlight = current;
    return current;
  }

  private async pollOnce(): Promise<ManagedProviderPollResult> {
    const lease = tryAcquireManagedMonitorLease();
    if (!lease.acquired) {
      return { ...emptyResult(), leaseUnavailable: true, leaseReason: lease.reason || 'contended' };
    }

    let leaseHealthy = true;
    const renew = (): boolean => {
      if (leaseHealthy && !lease.renew()) {
        leaseHealthy = false;
        this.log('Managed-provider polling stopped because its cross-window lease could not be renewed.');
      }
      return leaseHealthy;
    };
    const heartbeat = setInterval(renew, LEASE_RENEWAL_MS);
    heartbeat.unref();
    let total = emptyResult();
    try {
      // Filter before the store's bounded slice so standalone history cannot
      // crowd active monitored ticket sessions out of the polling set.
      const monitoredProjects = new Set<string>();
      for (const session of listWorkSessions({
        status: 'active',
        monitoringEnabled: true,
      }).map(monitorableWorkSession)
        .filter((candidate): candidate is MonitoredWorkSessionRecord => Boolean(candidate))
        .filter(candidate => {
          const projectKey = candidate.projectPath || candidate.projectName;
          if (!projectKey || !monitoredProjects.has(projectKey)) {
            if (projectKey) { monitoredProjects.add(projectKey); }
            return true;
          }
          return false;
        })) {
        if (!renew()) {
          total.leaseUnavailable = true;
          total.leaseReason = 'renewal-failed';
          break;
        }
        let sessionResult = emptyResult();
        sessionResult = combine(sessionResult, await this.pollGitLab(session, renew));
        if (!renew()) {
          sessionResult.leaseUnavailable = true;
          sessionResult.leaseReason = 'renewal-failed';
        } else {
          sessionResult = combine(sessionResult, await this.pollCi(session, renew));
        }
        const hasProviderTarget = sessionResult.polled > 0
          || sessionResult.failures > 0
          || sessionResult.skipped > 0
          || session.providerBindings.some(binding =>
            binding.provider === 'gitlab' || binding.provider === 'jenkins' || binding.provider === 'sonar'
          );
        const summary = hasProviderTarget
          ? `Polled ${sessionResult.polled} provider context${sessionResult.polled === 1 ? '' : 's'}; ${sessionResult.failures} failed; ${sessionResult.skipped} skipped.`
          : 'No GitLab, Jenkins, or SonarQube provider is bound to this work session.';
        try {
          recordWorkSessionMonitoringResult(session.id, {
            polled: sessionResult.polled,
            failures: sessionResult.failures,
            skipped: sessionResult.skipped,
            attemptedAt: new Date().toISOString(),
            summary,
          });
        } catch (error: unknown) {
          this.log(`Could not persist monitoring readiness for ${session.ticketKey}.`, unknownErrorMessage(error, 'Monitoring state write failed.'));
        }
        total = combine(total, sessionResult);
        if (sessionResult.leaseUnavailable) { break; }
      }
      if (!leaseHealthy) {
        total.leaseUnavailable = true;
        total.leaseReason = 'renewal-failed';
      }
      if (total.polled > 0 || total.transitions > 0) { this.options.refresh?.(); }
      return total;
    } finally {
      clearInterval(heartbeat);
      if (!lease.release()) { this.log('Managed-provider polling lease was no longer owned at release.'); }
    }
  }

  private async pollGitLab(
    session: MonitoredWorkSessionRecord,
    retainLease: () => boolean,
  ): Promise<ManagedProviderPollResult> {
    const binding = latestGitLabMergeRequestBinding(session);
    const state = this.options.state();
    const ticket = state?.tickets[session.ticketKey];
    let target = configuredGitLabPollingTarget(state, session);
    let discoveryDetail: string | undefined;
    if (!target) {
      const config = projectConfigurationForMonitoringSession(state, session);
      const configuredProject = config.gitlab_project_id || config.gitlab_project_path;
      if (configuredProject) {
        const sourceBranch = ticket?.mr?.source_branch
          || ticket?.mr?.sourceBranch
          || ticket?.mr?.branch
          || ticket?.mr?.head_branch
          || (session.projectPath ? readProjectGitBranch(session.projectPath)?.branch : undefined);
        try {
          const discovery = await gitlabRestClient.discoverOpenMergeRequest({
            projectIdOrPath: String(configuredProject),
            ticketKey: session.ticketKey,
            ...(sourceBranch && !sourceBranch.startsWith('detached@') ? { sourceBranch } : {}),
          });
          if (discovery.match) {
            target = {
              iid: discovery.match.iid,
              projectIdOrPath: String(configuredProject),
              ...(discovery.match.webUrl ? { providerUrl: discovery.match.webUrl } : {}),
            };
            discoveryDetail = `Matched automatically by ${discovery.strategy === 'source-branch' ? 'current branch' : 'ticket key'}.`;
          } else {
            const detail = discovery.ambiguous
              ? `Found ${discovery.candidateCount} possible open merge requests; Kronos will not guess.`
              : 'No unique open merge request matched the current branch or ticket key yet.';
            this.log(`GitLab monitoring is waiting for ${session.ticketKey}.`, detail);
            return { ...emptyResult(), skipped: 1 };
          }
        } catch (error: unknown) {
          this.log(`GitLab MR discovery failed for ${session.ticketKey}.`, unknownErrorMessage(error, 'GitLab MR discovery failed.'));
          return { ...emptyResult(), failures: 1 };
        }
      }
    }
    if (!target) {
      if (!binding && !ticket?.mr?.iid) { return emptyResult(); }
      const candidateIid = Number(binding?.subjectId || ticket?.mr?.iid);
      const detail = Number.isSafeInteger(candidateIid) && candidateIid > 0
        ? 'No GitLab project ID or path is configured for the current merge request.'
        : 'The current merge request has no valid IID.';
      this.log(`Skipped GitLab monitoring for ${session.ticketKey}.`, detail);
      return { ...emptyResult(), skipped: 1 };
    }
    const { iid, projectIdOrPath, providerUrl } = target;
    try {
      session = reconcileProviderBinding(session, {
        provider: 'gitlab',
        resource: 'merge-request',
        subjectId: String(iid),
        projectId: projectIdOrPath,
        ...(providerUrl ? { url: providerUrl } : {}),
      });
      if (discoveryDetail) {
        this.log(
          `GitLab monitoring found MR !${iid} for ${session.ticketKey}.`,
          `${discoveryDetail} The durable local session binding is ready.`,
        );
      }
    } catch (error: unknown) {
      this.log(
        `GitLab monitoring could not bind MR !${iid} to ${session.ticketKey}.`,
        unknownErrorMessage(error, 'GitLab session binding write failed.'),
      );
      return { ...emptyResult(), failures: 1 };
    }

    let snapshot;
    try {
      snapshot = await gitlabRestClient.mergeRequestMonitor(
        { projectIdOrPath, iid },
        { includeReview: true },
      );
    } catch (error: unknown) {
      this.log(`GitLab monitoring failed for ${session.ticketKey}.`, unknownErrorMessage(error, 'GitLab monitoring failed.'));
      const failureResult = { ...emptyResult(), failures: 1 };
      if (!retainLease()) { return leaseLost(failureResult); }
      try {
        const readNotice = updateGitLabMergeRequestReadStatus(
          session,
          iid,
          {
            state: 'failed',
            components: ['merge-request'],
            reason: providerReadFailureReason(error),
          },
          providerUrl,
          this.options.log,
        );
        if (readNotice) {
          this.options.notify?.(readNotice);
          failureResult.transitions = 1;
        }
      } catch (statusError: unknown) {
        this.log(
          `Could not persist GitLab read failure state for ${session.ticketKey}.`,
          unknownErrorMessage(statusError, 'GitLab read failure state write failed.'),
        );
      }
      return failureResult;
    }
    const incompleteComponents = gitLabIncompleteMonitorComponents(snapshot.completeness);
    const providerPartial = incompleteComponents.length > 0;
    if (providerPartial) {
      this.log(
        `GitLab provider monitoring was partial for ${session.ticketKey}.`,
        snapshot.completeness.warnings.join(' ') || 'One or more bounded provider reads were incomplete.',
      );
    }
    const result = { ...emptyResult(), polled: 1, skipped: providerPartial ? 1 : 0 };
    if (!retainLease()) { return leaseLost(result); }

    const notices: ManagedProviderNotice[] = [];
    let stateFailures = 0;
    try {
      const readNotice = updateGitLabMergeRequestReadStatus(
        session,
        iid,
        providerPartial
          ? { state: 'partial', components: incompleteComponents, reason: 'bounded_read_incomplete' }
          : { state: 'complete', reason: 'complete' },
        providerUrl,
        this.options.log,
      );
      if (readNotice) { notices.push(readNotice); }
    } catch (error: unknown) {
      stateFailures += 1;
      this.log(
        `GitLab read-status monitoring failed for ${session.ticketKey}.`,
        unknownErrorMessage(error, 'GitLab read-status monitoring failed.'),
      );
    }
    try {
      const observedMr = normalizeGitLabMergeRequestDigest(snapshot);
      if (observedMr) {
        session = reconcileProviderBinding(session, {
          provider: 'gitlab',
          resource: 'merge-request',
          subjectId: String(iid),
          projectId: projectIdOrPath,
          ...((observedMr.url || providerUrl) ? { url: observedMr.url || providerUrl } : {}),
        });
        const previousMr = safeReadGitLabMergeRequestBaseline(session, this.options.log);
        const mrDigest = previousMr
          ? mergeGitLabMergeRequestDigest(previousMr, observedMr) || observedMr
          : observedMr;
        const mrSnapshotPath = gitLabMergeRequestMonitorSnapshotPath(session.id);
        if (!retainLease()) {
          for (const item of notices) { this.options.notify?.(item); }
          return leaseLost({ ...result, transitions: notices.length, failures: stateFailures });
        }
        if (!previousMr) {
          const initial = initialGitLabMergeRequestNotice(
            session,
            mrDigest,
            mrSnapshotPath,
            mrDigest.url || providerUrl,
          );
          if (initial) { notices.push(initial); }
          appendBaselineOnce(
            session,
            'gitlab',
            'merge-request',
            String(mrDigest.iid),
            mergeRequestEventState(mrDigest),
            mrDigest.fingerprint,
            mrSnapshotPath,
            mergeRequestMetadata(mrDigest, 'baseline'),
          );
        } else {
          for (const transition of compareGitLabMergeRequestDigests(previousMr, mrDigest)) {
            const notice = appendGitLabMergeRequestTransitionOnce(
              session,
              transition,
              mrSnapshotPath,
              mrDigest.url || providerUrl,
            );
            if (notice) { notices.push(notice); }
          }
        }
        const openReminder = appendOpenMergeRequestReminder(
          session,
          mrDigest,
          mrSnapshotPath,
          mrDigest.url || providerUrl,
        );
        if (openReminder) { notices.push(openReminder); }
        if (!previousMr || previousMr.fingerprint !== mrDigest.fingerprint) {
          writeGitLabMergeRequestMonitorSnapshot(session.id, mrDigest);
        }
        const currentTicket = this.options.state()?.tickets[session.ticketKey];
        if (currentTicket) {
          const projected = effectiveTicketMergeRequest(currentTicket, session, mrDigest);
          if (projected) {
            this.options.projectTicketProviderState?.(session.ticketKey, { mr: projected });
          }
        }
      }
    } catch (error: unknown) {
      stateFailures += 1;
      this.log(
        `GitLab merge-request monitoring state failed for ${session.ticketKey}.`,
        unknownErrorMessage(error, 'GitLab merge-request monitoring state failed.'),
      );
    }

    if (!retainLease()) {
      for (const item of notices) { this.options.notify?.(item); }
      return leaseLost({ ...result, transitions: notices.length, failures: stateFailures });
    }
    try {
      const observedPipeline = normalizeGitLabPipelineDigest(snapshot);
      if (observedPipeline) {
        const previousPipeline = safeReadGitLabBaseline(session, this.options.log);
        const pipelineDigest = previousPipeline
          ? mergeGitLabPipelineDigest(previousPipeline, observedPipeline) || observedPipeline
          : observedPipeline;
        const pipelineSnapshotPath = gitLabPipelineMonitorSnapshotPath(session.id);
        if (!retainLease()) {
          for (const item of notices) { this.options.notify?.(item); }
          return leaseLost({ ...result, transitions: notices.length, failures: stateFailures });
        }
        if (!previousPipeline) {
          const initial = initialGitLabNotice(session, iid, pipelineDigest, pipelineSnapshotPath);
          if (initial) { notices.push(initial); }
          appendBaselineOnce(
            session,
            'gitlab',
            'pipeline',
            String(pipelineDigest.id),
            pipelineDigest.status,
            pipelineDigest.fingerprint,
            pipelineSnapshotPath,
            { mergeRequestIid: iid, pipelineId: pipelineDigest.id },
          );
        } else {
          for (const transition of compareGitLabPipelineDigests(previousPipeline, pipelineDigest)) {
            const notice = appendGitLabTransitionOnce(
              session,
              iid,
              transition,
              pipelineSnapshotPath,
              pipelineDigest.url,
            );
            if (notice) { notices.push(notice); }
          }
        }
        if (!previousPipeline || previousPipeline.fingerprint !== pipelineDigest.fingerprint) {
          writeGitLabPipelineMonitorSnapshot(session.id, pipelineDigest);
        }
      }
    } catch (error: unknown) {
      stateFailures += 1;
      this.log(
        `GitLab pipeline monitoring state failed for ${session.ticketKey}.`,
        unknownErrorMessage(error, 'GitLab pipeline monitoring state failed.'),
      );
    }

    for (const item of notices) { this.options.notify?.(item); }
    return { ...result, transitions: notices.length, failures: stateFailures };
  }

  private async pollCi(
    session: MonitoredWorkSessionRecord,
    retainLease: () => boolean,
  ): Promise<ManagedProviderPollResult> {
    const state = this.options.state();
    const targets = configuredCiPollingTargets(state, session);
    const jenkinsUrl = targets.jenkinsUrl;
    let sonarTarget = targets.sonar;
    if (!jenkinsUrl && !sonarTarget) { return emptyResult(); }

    let result = emptyResult();
    try {
      if (jenkinsUrl) {
        session = reconcileProviderBinding(session, {
          id: 'jenkins-job',
          provider: 'jenkins',
          resource: 'job',
          subjectId: 'configured',
          url: jenkinsUrl,
        });
      }
      if (sonarTarget) {
        const dashboardUrl = sonarTarget.providerUrl
          || sonarDashboardUrl(sonarTarget.projectKey, sonarTarget.branch);
        session = reconcileProviderBinding(session, {
          provider: 'sonar',
          resource: 'quality-gate',
          subjectId: `${sonarTarget.projectKey}:${sonarTarget.branch}`,
          projectId: sonarTarget.projectKey,
          ...(dashboardUrl ? { url: dashboardUrl } : {}),
        });
      }
    } catch (error: unknown) {
      this.log(
        `CI monitoring could not persist provider bindings for ${session.ticketKey}.`,
        unknownErrorMessage(error, 'CI session binding write failed.'),
      );
      return { ...result, failures: 1 };
    }
    const notices: ManagedProviderNotice[] = [];
    let jenkins: JenkinsBuildContext | undefined;
    let sonar: SonarBranchContext | undefined;
    let jenkinsReadFailure: string | undefined;
    let sonarReadFailure: string | undefined;
    if (jenkinsUrl) {
      try {
        const jenkinsBranch = sonarTarget?.branch
          || configuredSonarBranchName(state, session.ticketKey)
          || undefined;
        jenkins = await jenkinsRestClient.buildContext(
          jenkinsUrl,
          jenkinsBranch ? { branch: jenkinsBranch } : {},
        );
        session = reconcileProviderBinding(session, {
          provider: 'jenkins',
          resource: 'build',
          subjectId: String(jenkins.build.number),
          url: jenkins.build.url || jenkins.jobOrBuildUrl || jenkinsUrl,
        });
        result.polled += 1;
        this.options.projectTicketProviderState?.(session.ticketKey, {
          build: {
            number: jenkins.build.number,
            status: jenkins.build.status,
            url: jenkins.build.url || jenkins.jobOrBuildUrl || jenkinsUrl,
          },
        });
        const discoveredProjectKey = jenkins.sonarProjectKey
          || (!sonarTarget && isSonarRestConfigured() ? sonarProjectKeyHeuristic(state, session) : undefined);
        if (discoveredProjectKey) {
          const branch = jenkins.sonarBranch
            || sonarTarget?.branch
            || configuredSonarBranchName(state, session.ticketKey);
          const discoveredOverridesMismatch = Boolean(jenkins.sonarProjectKey
            && sonarTarget?.projectKey !== jenkins.sonarProjectKey);
          if (branch && (!sonarTarget || discoveredOverridesMismatch)) {
            const providerUrl = sonarDashboardUrl(discoveredProjectKey, branch);
            sonarTarget = {
              projectKey: discoveredProjectKey,
              branch,
              ...(providerUrl ? { providerUrl } : {}),
            };
            session = reconcileProviderBinding(session, {
              provider: 'sonar',
              resource: 'quality-gate',
              subjectId: `${discoveredProjectKey}:${branch}`,
              projectId: discoveredProjectKey,
              ...(providerUrl ? { url: providerUrl } : {}),
            });
            const projectName = monitoringProjectName(state, session);
            if (projectName) {
              this.options.updateProjectSonarTarget?.(projectName, discoveredProjectKey, branch);
            }
            this.log(
              `Jenkins discovered SonarQube project ${discoveredProjectKey} for ${session.ticketKey}.`,
              `${jenkins.sonarProjectKey ? 'Kronos bound the literal pipeline configuration' : 'Kronos used the registered repository-name heuristic'} to branch ${branch}.`,
            );
          }
        }
      } catch (error: unknown) {
        jenkinsReadFailure = providerReadFailureReason(error);
        result.failures += 1;
        this.log(`Jenkins monitoring failed for ${session.ticketKey}.`, unknownErrorMessage(error, 'Jenkins monitoring failed.'));
      }
      if (!retainLease()) { return leaseLost(result); }
      try {
        const readNotice = appendProviderReadStatusTransition(
          session,
          'jenkins',
          jenkinsReadFailure ? 'failed' : jenkins?.completeness.complete ? 'complete' : 'partial',
          jenkinsReadFailure || (jenkins?.completeness.complete ? 'complete' : 'bounded_read_incomplete'),
          jenkins?.build.url || jenkins?.jobOrBuildUrl || jenkinsUrl,
          jenkins ? jenkinsIncompleteReadComponents(jenkins) : [],
        );
        if (readNotice) { notices.push(readNotice); }
      } catch (error: unknown) {
        result.failures += 1;
        this.log(
          `Jenkins read-status monitoring failed for ${session.ticketKey}.`,
          unknownErrorMessage(error, 'Jenkins read-status monitoring failed.'),
        );
      }
    }
    if (sonarTarget) {
      try {
        sonar = await sonarRestClient.branchContext(sonarTarget.projectKey, sonarTarget.branch);
        session = reconcileProviderBinding(session, {
          provider: 'sonar',
          resource: 'quality-gate',
          subjectId: `${sonar.projectKey}:${sonar.branch}`,
          projectId: sonar.projectKey,
          url: sonar.dashboardUrl,
        });
        result.polled += 1;
      } catch (error: unknown) {
        sonarReadFailure = providerReadFailureReason(error);
        result.failures += 1;
        this.log(`SonarQube monitoring failed for ${session.ticketKey}.`, unknownErrorMessage(error, 'SonarQube monitoring failed.'));
      }
      if (!retainLease()) {
        for (const item of notices) { this.options.notify?.(item); }
        result.transitions += notices.length;
        return leaseLost(result);
      }
      try {
        const readNotice = appendProviderReadStatusTransition(
          session,
          'sonar',
          sonarReadFailure ? 'failed' : sonar?.completeness.complete ? 'complete' : 'partial',
          sonarReadFailure || (sonar?.completeness.complete ? 'complete' : 'bounded_read_incomplete'),
          sonar?.dashboardUrl || sonarTarget.providerUrl,
          sonar ? sonarIncompleteReadComponents(sonar) : [],
        );
        if (readNotice) { notices.push(readNotice); }
      } catch (error: unknown) {
        result.failures += 1;
        this.log(
          `SonarQube read-status monitoring failed for ${session.ticketKey}.`,
          unknownErrorMessage(error, 'SonarQube read-status monitoring failed.'),
        );
      }
    }
    if (result.polled === 0) {
      for (const item of notices) { this.options.notify?.(item); }
      result.transitions += notices.length;
      return result;
    }

    try {
      const previous = safeReadCiBaseline(session, this.options.log);
      const input: { jenkins?: JenkinsBuildContext; sonar?: SonarBranchContext } = {};
      if (jenkins) { input.jenkins = jenkins; }
      if (sonar) { input.sonar = sonar; }
      const live = buildCiMonitorDigest(input);
      const merged: { schemaVersion: 1; jenkins?: unknown; sonar?: unknown } = { schemaVersion: 1 };
      if (live?.jenkins) { merged.jenkins = live.jenkins; }
      else if (jenkinsUrl && previous?.jenkins) { merged.jenkins = previous.jenkins; }
      if (live?.sonar) { merged.sonar = live.sonar; }
      else if (sonarTarget && previous?.sonar) { merged.sonar = previous.sonar; }
      const observed = normalizeCiMonitorDigest(merged);
      if (!observed) { return result; }
      const digest = previous ? mergeCiMonitorDigest(previous, observed) || observed : observed;
      const snapshotPath = ciMonitorSnapshotPath(session.id);
      if (!retainLease()) { return leaseLost(result); }

      if (!previous) {
        notices.push(...initialCiNotices(session, digest, snapshotPath));
        appendBaselineOnce(session, 'kronos', 'ci-monitor', session.ticketKey, ciDigestState(digest), digest.fingerprint, snapshotPath, {
          jenkinsIncluded: Boolean(digest.jenkins),
          sonarIncluded: Boolean(digest.sonar),
        });
      } else {
        for (const transition of compareCiMonitorDigests(previous, digest)) {
          const notice = appendCiTransitionOnce(session, transition, snapshotPath);
          if (notice) { notices.push(notice); }
        }
      }
      if (!previous || previous.fingerprint !== digest.fingerprint) {
        writeCiMonitorSnapshot(session.id, digest);
      }
      for (const notice of notices) { this.options.notify?.(notice); }
      result.transitions += notices.length;
      return result;
    } catch (error: unknown) {
      this.log(`CI monitoring state failed for ${session.ticketKey}.`, unknownErrorMessage(error, 'CI monitoring state failed.'));
      result.failures += 1;
      for (const item of notices) { this.options.notify?.(item); }
      result.transitions += notices.length;
      return result;
    }
  }

  private log(message: string, detail?: string): void {
    this.options.log?.(message, detail);
  }
}

function monitoringProjectName(
  state: KronosStateSnapshot | null,
  session: TicketWorkSessionRecord,
): string | undefined {
  return session.projectName || state?.tickets[session.ticketKey]?.launch_project;
}

function sonarProjectKeyHeuristic(
  state: KronosStateSnapshot | null,
  session: TicketWorkSessionRecord,
): string | undefined {
  const config = projectConfigurationForMonitoringSession(state, session);
  const candidate = optionalTrimmedStringFromUnknown(config.repo_name)
    || optionalTrimmedStringFromUnknown(session.projectName);
  return candidate && /^[A-Za-z0-9_.:-]{1,400}$/.test(candidate) ? candidate : undefined;
}

function reconcileProviderBinding(
  session: TicketWorkSessionRecord,
  input: AddWorkSessionProviderBindingInput,
): TicketWorkSessionRecord {
  const current = newestProviderBinding(session, input.provider, input.resource, input.subjectId);
  const projectMatches = input.projectId === undefined || current?.projectId === input.projectId;
  const urlMatches = input.url === undefined || current?.url === input.url;
  const idMatches = input.id === undefined || current?.id === input.id;
  if (current && projectMatches && urlMatches && idMatches) { return session; }
  const updated = addWorkSessionProviderBinding(session.id, {
    ...input,
    ...(!input.id && current ? { id: current.id } : {}),
  });
  const monitored = monitorableWorkSession(updated);
  if (!monitored) { throw new Error('Provider polling requires at least one explicit ticket context.'); }
  return monitored;
}

function newestProviderBinding(
  session: TicketWorkSessionRecord,
  provider: AddWorkSessionProviderBindingInput['provider'],
  resource: AddWorkSessionProviderBindingInput['resource'],
  subjectId?: string,
) {
  return newestWorkSessionProviderBinding(
    session.providerBindings,
    binding => binding.provider === provider
      && binding.resource === resource
      && (subjectId === undefined || binding.subjectId === subjectId),
  );
}

function emptyResult(): ManagedProviderPollResult {
  return { polled: 0, transitions: 0, failures: 0, skipped: 0, leaseUnavailable: false };
}

function monitorableWorkSession(session: WorkSessionRecord): MonitoredWorkSessionRecord | undefined {
  const ticketKey = session.kind === 'ticket' ? session.ticketKey : session.ticketKeys[0];
  return ticketKey ? { ...session, ticketKey } : undefined;
}

function projectConfigurationForMonitoringSession(
  state: KronosStateSnapshot | null,
  session: MonitoredWorkSessionRecord,
) {
  const ticket = state?.tickets[session.ticketKey];
  const config = projectConfigurationForTicket(state, ticket);
  return session.projectName
    ? { ...config, ...(state?.projects[session.projectName]?.config || {}) }
    : config;
}

function combine(left: ManagedProviderPollResult, right: ManagedProviderPollResult): ManagedProviderPollResult {
  const value: ManagedProviderPollResult = {
    polled: left.polled + right.polled,
    transitions: left.transitions + right.transitions,
    failures: left.failures + right.failures,
    skipped: left.skipped + right.skipped,
    leaseUnavailable: left.leaseUnavailable || right.leaseUnavailable,
  };
  const reason = left.leaseReason || right.leaseReason;
  if (reason) { value.leaseReason = reason; }
  return value;
}

function leaseLost(result: ManagedProviderPollResult): ManagedProviderPollResult {
  return { ...result, leaseUnavailable: true, leaseReason: 'renewal-failed' };
}

function safeReadGitLabBaseline(
  session: TicketWorkSessionRecord,
  log: ManagedProviderMonitorOptions['log'],
): GitLabPipelineDigest | null {
  try {
    return readGitLabPipelineMonitorSnapshot(session.id);
  } catch (error: unknown) {
    log?.(`Ignored an invalid GitLab baseline for ${session.ticketKey}.`, unknownErrorMessage(error, 'Invalid baseline.'));
    return null;
  }
}

function safeReadGitLabMergeRequestBaseline(
  session: TicketWorkSessionRecord,
  log: ManagedProviderMonitorOptions['log'],
): GitLabMergeRequestDigest | null {
  try {
    return readGitLabMergeRequestMonitorSnapshot(session.id);
  } catch (error: unknown) {
    log?.(
      `Ignored an invalid GitLab merge-request baseline for ${session.ticketKey}.`,
      unknownErrorMessage(error, 'Invalid merge-request baseline.'),
    );
    return null;
  }
}

function safeReadGitLabMergeRequestReadStatus(
  session: TicketWorkSessionRecord,
  log: ManagedProviderMonitorOptions['log'],
): GitLabMergeRequestReadStatus | null {
  try {
    return readGitLabMergeRequestReadStatus(session.id);
  } catch (error: unknown) {
    log?.(
      `Ignored an invalid GitLab read-status baseline for ${session.ticketKey}.`,
      unknownErrorMessage(error, 'Invalid GitLab read-status baseline.'),
    );
    return null;
  }
}

function safeReadCiBaseline(
  session: TicketWorkSessionRecord,
  log: ManagedProviderMonitorOptions['log'],
): CiMonitorDigest | null {
  try {
    return readCiMonitorSnapshot(session.id);
  } catch (error: unknown) {
    log?.(`Ignored an invalid CI baseline for ${session.ticketKey}.`, unknownErrorMessage(error, 'Invalid baseline.'));
    return null;
  }
}

function appendBaselineOnce(
  session: TicketWorkSessionRecord,
  source: MonitorEventSource,
  kind: string,
  subjectId: string,
  state: string,
  fingerprint: string,
  artifactPath: string,
  metadata: Record<string, string | number | boolean | null>,
): void {
  const id = deterministicEventId(session.id, source, 'baseline', subjectId, fingerprint);
  if (readMonitorEvent(id)) { return; }
  appendMonitorEvent({
    id,
    sessionId: session.id,
    type: 'provider.baseline',
    source,
    summary: `${session.ticketKey} ${kind} baseline recorded.`,
    subject: { kind, id: subjectId, ticketKey: session.ticketKey },
    after: { state, fingerprint },
    artifactPath,
    metadata,
  });
}

function initialGitLabNotice(
  session: TicketWorkSessionRecord,
  iid: number,
  digest: GitLabPipelineDigest,
  artifactPath: string,
): ManagedProviderNotice | null {
  if (!gitLabDigestUnhealthy(digest)) { return null; }
  const summary = `${session.ticketKey} was first observed with pipeline ${digest.id} unhealthy (${digest.status}; ${digest.failedJobs.length} failed blocking job${digest.failedJobs.length === 1 ? '' : 's'}; ${digest.tests.failed + digest.tests.error} failed/error test${digest.tests.failed + digest.tests.error === 1 ? '' : 's'}).`;
  const event = appendTransitionOnce({
    session,
    source: 'gitlab',
    summary,
    subject: { kind: 'pipeline', id: String(digest.id), ticketKey: session.ticketKey },
    state: digest.status,
    fingerprint: digest.fingerprint,
    artifactPath,
    transitionKey: `initial-unhealthy-${digest.id}`,
    metadata: {
      transitionKind: 'initial_unhealthy',
      mergeRequestIid: iid,
      pipelineId: digest.id,
      failedJobCount: digest.failedJobs.length,
      failedTestCount: digest.tests.failed + digest.tests.error,
    },
  });
  return event ? notice(event, session, 'warning', digest.url, 'kronos.insertGitLabContext') : null;
}

function initialGitLabMergeRequestNotice(
  session: TicketWorkSessionRecord,
  digest: GitLabMergeRequestDigest,
  artifactPath: string,
  providerUrl: string | undefined,
): ManagedProviderNotice | null {
  const needsAttention = gitLabMergeRequestNeedsAttention(digest);
  const reasons: string[] = [];
  if (digest.changesRequested === true) { reasons.push('changes requested'); }
  if (digest.discussionsComplete && digest.unresolvedDiscussions.count > 0) {
    reasons.push(`${digest.unresolvedDiscussions.count} unresolved discussion${digest.unresolvedDiscussions.count === 1 ? '' : 's'}`);
  }
  const summary = needsAttention
    ? `${session.ticketKey} MR !${digest.iid} needs attention: ${reasons.join('; ')}.`
    : `${session.ticketKey} MR !${digest.iid} first observed (${mergeRequestEventState(digest)}).`;
  const event = appendTransitionOnce({
    session,
    source: 'gitlab',
    summary,
    subject: { kind: 'merge-request', id: String(digest.iid), ticketKey: session.ticketKey },
    state: mergeRequestEventState(digest),
    fingerprint: digest.fingerprint,
    artifactPath,
    transitionKey: needsAttention
      ? `initial-mr-attention:${digest.fingerprint}`
      : `initial-mr-observed:${digest.fingerprint}`,
    metadata: mergeRequestMetadata(digest, needsAttention ? 'initial_mr_attention' : 'initial_mr_observed'),
  });
  return event
    ? notice(event, session, needsAttention ? 'warning' : 'information', providerUrl, 'kronos.insertGitLabContext')
    : null;
}

function initialCiNotices(
  session: TicketWorkSessionRecord,
  digest: CiMonitorDigest,
  artifactPath: string,
): ManagedProviderNotice[] {
  const notices: ManagedProviderNotice[] = [];
  const jenkins = digest.jenkins;
  if (jenkins && (FAILURE_BUILD_STATUSES.has(jenkins.status.toLowerCase())
    || jenkins.failedTestCount > 0
    || jenkins.failedStageNames.length > 0)) {
    const summary = `${session.ticketKey} was first observed with Jenkins build ${jenkins.buildNumber} unhealthy (${jenkins.status}; ${jenkins.failedTestCount} failed test${jenkins.failedTestCount === 1 ? '' : 's'}; ${jenkins.failedStageNames.length} failed stage${jenkins.failedStageNames.length === 1 ? '' : 's'}).`;
    const event = appendTransitionOnce({
      session,
      source: 'jenkins',
      summary,
      subject: { kind: 'build', id: String(jenkins.buildNumber), ticketKey: session.ticketKey },
      state: jenkins.status,
      fingerprint: jenkins.fingerprint,
      artifactPath,
      transitionKey: `initial-unhealthy-build-${jenkins.buildNumber}`,
      metadata: {
        transitionKind: 'initial_unhealthy',
        buildNumber: jenkins.buildNumber,
        failedTestCount: jenkins.failedTestCount,
        failedStageCount: jenkins.failedStageNames.length,
      },
    });
    if (event) { notices.push(notice(event, session, 'warning', jenkins.buildUrl, 'kronos.insertCiContext')); }
  }
  const sonar = digest.sonar;
  if (sonar && sonar.gateAvailable) {
    const healthy = PASSING_SONAR_GATES.has(sonar.gateStatus.toLowerCase());
    const summary = healthy
      ? `${session.ticketKey} was first observed with a healthy SonarQube quality gate (${sonar.gateStatus}; ${sonar.unresolvedIssueCount} unresolved issue${sonar.unresolvedIssueCount === 1 ? '' : 's'}).`
      : `${session.ticketKey} was first observed with SonarQube quality gate ${sonar.gateStatus} (${sonar.unresolvedIssueCount} unresolved issue${sonar.unresolvedIssueCount === 1 ? '' : 's'}).`;
    const event = appendTransitionOnce({
      session,
      source: 'sonar',
      summary,
      subject: { kind: 'quality-gate', id: `${sonar.projectKey}:${sonar.branch}`, ticketKey: session.ticketKey },
      state: sonar.gateStatus,
      fingerprint: sonar.fingerprint,
      artifactPath,
      transitionKey: `initial-${healthy ? 'healthy' : 'unhealthy'}-gate-${sonar.projectKey}-${sonar.branch}`,
      metadata: {
        transitionKind: healthy ? 'initial_healthy' : 'initial_unhealthy',
        projectKey: sonar.projectKey,
        branch: sonar.branch,
        unresolvedIssueCount: sonar.unresolvedIssueCount,
      },
    });
    if (event) {
      notices.push(notice(
        event,
        session,
        healthy ? 'information' : 'warning',
        sonar.dashboardUrl,
        'kronos.insertCiContext',
      ));
    }
  }
  return notices;
}

function appendGitLabTransitionOnce(
  session: TicketWorkSessionRecord,
  iid: number,
  transition: GitLabPipelineTransition,
  artifactPath: string,
  url: string | undefined,
): ManagedProviderNotice | null {
  const summary = `${session.ticketKey} pipeline ${transition.pipelineId}: ${transitionLabel(transition.kind)} (${transition.currentStatus}).`;
  const event = appendTransitionOnce({
    session,
    source: 'gitlab',
    summary,
    subject: { kind: 'pipeline', id: String(transition.pipelineId), ticketKey: session.ticketKey },
    state: transition.currentStatus,
    fingerprint: transition.currentFingerprint,
    artifactPath,
    transitionKey: transition.key,
    metadata: {
      transitionKind: transition.kind,
      mergeRequestIid: iid,
      pipelineId: transition.pipelineId,
      failedJobCount: transition.jobs.length,
      failedTestCount: transition.tests.failed + transition.tests.error,
    },
  });
  if (!event) { return null; }
  return notice(event, session, transitionIsFailure(transition.kind) ? 'warning' : 'information', url, 'kronos.insertGitLabContext');
}

function appendGitLabMergeRequestTransitionOnce(
  session: TicketWorkSessionRecord,
  transition: GitLabMergeRequestTransition,
  artifactPath: string,
  providerUrl: string | undefined,
): ManagedProviderNotice | null {
  const digest = transition.current;
  const event = appendTransitionOnce({
    session,
    source: 'gitlab',
    summary: mergeRequestTransitionSummary(session.ticketKey, transition),
    subject: { kind: 'merge-request', id: String(digest.iid), ticketKey: session.ticketKey },
    state: mergeRequestEventState(digest),
    fingerprint: digest.fingerprint,
    beforeState: mergeRequestEventState(transition.previous),
    beforeFingerprint: transition.previous.fingerprint,
    artifactPath,
    transitionKey: transition.key,
    metadata: mergeRequestMetadata(digest, transition.kind),
  });
  if (!event) { return null; }
  return notice(
    event,
    session,
    mergeRequestTransitionIsWarning(transition.kind) ? 'warning' : 'information',
    providerUrl,
    'kronos.insertGitLabContext',
  );
}

function appendOpenMergeRequestReminder(
  session: TicketWorkSessionRecord,
  digest: GitLabMergeRequestDigest,
  artifactPath: string,
  providerUrl: string | undefined,
): ManagedProviderNotice | null {
  if (digest.state.trim().toLowerCase() !== 'opened') { return null; }
  const recent = listMonitorEvents({
    sessionId: session.id,
    types: ['provider.transition', 'notification.acknowledged'],
    limit: 2000,
  });
  const latestMergeRequestEvent = recent.find(event => event.type === 'provider.transition'
    && event.source === 'gitlab'
    && event.subject?.kind === 'merge-request'
    && event.subject.id === String(digest.iid));
  if (!latestMergeRequestEvent) { return null; }
  const acknowledgement = recent.find(event => event.type === 'notification.acknowledged'
    && event.metadata?.['acknowledgedEventId'] === latestMergeRequestEvent.id);
  if (!acknowledgement) { return null; }
  const needsAttention = gitLabMergeRequestNeedsAttention(digest);
  const event = appendTransitionOnce({
    session,
    source: 'gitlab',
    summary: needsAttention
      ? `${session.ticketKey} MR !${digest.iid} remains open and still needs attention after being cleared.`
      : `${session.ticketKey} MR !${digest.iid} remains open after being cleared from Attention.`,
    subject: { kind: 'merge-request', id: String(digest.iid), ticketKey: session.ticketKey },
    state: mergeRequestEventState(digest),
    fingerprint: digest.fingerprint,
    artifactPath,
    transitionKey: `open-mr-reminder:${acknowledgement.id}`,
    metadata: {
      ...mergeRequestMetadata(digest, 'open_mr_reminder'),
      reminderAfterAcknowledgementId: acknowledgement.id,
    },
  });
  return event
    ? notice(event, session, needsAttention ? 'warning' : 'information', providerUrl, 'kronos.insertGitLabContext')
    : null;
}

function appendCiTransitionOnce(
  session: TicketWorkSessionRecord,
  transition: CiMonitorTransition,
  artifactPath: string,
): ManagedProviderNotice | null {
  const source: MonitorEventSource = transition.provider === 'jenkins' ? 'jenkins' : 'sonar';
  const subject: MonitorEventSubject = transition.provider === 'jenkins'
    ? { kind: 'build', id: String(transition.buildNumber), ticketKey: session.ticketKey }
    : { kind: 'quality-gate', id: `${transition.projectKey}:${transition.branch}`, ticketKey: session.ticketKey };
  const state = transition.provider === 'jenkins' ? transition.status : transition.gateStatus;
  const url = transition.url;
  const metadata: Record<string, string | number | boolean | null> = {
    transitionKind: transition.kind,
  };
  if (transition.provider === 'jenkins') {
    metadata['buildNumber'] = transition.buildNumber;
    metadata['failedTestCount'] = transition.failedTestCount;
    metadata['failedStageCount'] = transition.failedStageNames.length;
  } else {
    metadata['issueDelta'] = transition.issueDelta;
    metadata['unresolvedIssueCount'] = transition.unresolvedIssueCount;
    metadata['projectKey'] = transition.projectKey;
    metadata['branch'] = transition.branch;
  }
  const event = appendTransitionOnce({
    session,
    source,
    summary: `${session.ticketKey} ${transition.provider === 'jenkins' ? 'Jenkins' : 'SonarQube'}: ${transitionLabel(transition.kind)} (${state}).`,
    subject,
    state,
    fingerprint: transition.currentFingerprint,
    artifactPath,
    transitionKey: transition.key,
    metadata,
  });
  if (!event) { return null; }
  return notice(event, session, transitionIsFailure(transition.kind) ? 'warning' : 'information', url, 'kronos.insertCiContext');
}

interface AppendTransitionInput {
  session: TicketWorkSessionRecord;
  source: MonitorEventSource;
  summary: string;
  subject: MonitorEventSubject;
  state: string;
  fingerprint: string;
  beforeState?: string;
  beforeFingerprint?: string;
  artifactPath: string;
  transitionKey: string;
  metadata: Record<string, string | number | boolean | null>;
}

function appendTransitionOnce(input: AppendTransitionInput): MonitorEvent | null {
  if (repeatsCurrentProviderReadState(input)) { return null; }
  const id = deterministicEventId(
    input.session.id,
    input.source,
    input.transitionKey,
    input.subject.id,
    input.fingerprint,
  );
  if (readMonitorEvent(id)) { return null; }
  const eventInput: Parameters<typeof appendMonitorEvent>[0] = {
    id,
    sessionId: input.session.id,
    type: 'provider.transition',
    source: input.source,
    summary: input.summary,
    subject: input.subject,
    after: { state: input.state, fingerprint: input.fingerprint },
    artifactPath: input.artifactPath,
    metadata: { ...input.metadata, transitionKey: input.transitionKey },
  };
  if (input.beforeState && input.beforeFingerprint) {
    eventInput.before = { state: input.beforeState, fingerprint: input.beforeFingerprint };
  }
  return appendMonitorEvent(eventInput);
}

function repeatsCurrentProviderReadState(input: AppendTransitionInput): boolean {
  const transitionKind = input.metadata['transitionKind'];
  if (transitionKind !== 'provider_read_failed'
    && transitionKind !== 'provider_read_partial'
    && transitionKind !== 'provider_read_recovered') {
    return false;
  }
  const previous = listMonitorEvents({
    sessionId: input.session.id,
    source: input.source,
    types: ['provider.transition'],
    limit: 2000,
  }).find(event => event.subject?.kind === input.subject.kind
    && event.subject.id === input.subject.id
    && isProviderReadTransitionKind(event.metadata?.['transitionKind']));
  if (!previous) { return false; }
  return providerReadStateSignature(
    previous.metadata?.['readState'],
    previous.after?.state,
    previous.metadata?.['readReason'],
    previous.metadata?.['readComponents'],
  ) === providerReadStateSignature(
    input.metadata['readState'],
    input.state,
    input.metadata['readReason'],
    input.metadata['readComponents'],
  );
}

function deterministicEventId(...parts: string[]): string {
  const hash = crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');
  return `transition-${hash.slice(0, 48)}`;
}

function gitLabDigestUnhealthy(digest: GitLabPipelineDigest): boolean {
  return FAILURE_PIPELINE_STATUSES.has(digest.status.toLowerCase())
    || digest.failedJobs.length > 0
    || digest.tests.failed + digest.tests.error > 0;
}

function mergeRequestTransitionSummary(
  ticketKey: string,
  transition: GitLabMergeRequestTransition,
): string {
  const iid = transition.current.iid;
  const prefix = `${ticketKey} MR !${iid}`;
  switch (transition.kind) {
    case 'merge_request_merged':
      return `${prefix} merged.`;
    case 'merge_request_closed':
      return `${prefix} closed without merging.`;
    case 'merge_request_reopened':
      return `${prefix} reopened.`;
    case 'merge_request_state_changed':
      return `${prefix} state changed from ${transition.previous.state} to ${transition.current.state}.`;
    case 'changes_requested':
      return `${prefix} has requested changes.`;
    case 'changes_request_cleared':
      return `${prefix} no longer has requested changes.`;
    case 'approval_satisfied':
      return `${prefix} now satisfies its approval requirements.`;
    case 'approval_required':
      return `${prefix} no longer satisfies its approval requirements.`;
    case 'approval_state_changed':
      return `${prefix} approval state changed (${approvalSummary(transition.current)}).`;
    case 'reviewers_changed':
      return `${prefix} reviewer assignment changed (${transition.current.reviewers.count} reviewer${transition.current.reviewers.count === 1 ? '' : 's'}).`;
    case 'unresolved_discussions_observed':
      return `${prefix} has ${transition.current.unresolvedDiscussions.count} unresolved discussion${transition.current.unresolvedDiscussions.count === 1 ? '' : 's'} on the first complete discussion read.`;
    case 'unresolved_discussions_increased':
      return `${prefix} has more unresolved discussions (${transition.previous.unresolvedDiscussions.count} -> ${transition.current.unresolvedDiscussions.count}).`;
    case 'unresolved_discussions_decreased':
      return `${prefix} resolved discussions (${transition.previous.unresolvedDiscussions.count} -> ${transition.current.unresolvedDiscussions.count} unresolved).`;
    case 'unresolved_discussions_changed':
      return `${prefix} unresolved discussion set changed (${transition.current.unresolvedDiscussions.count} unresolved).`;
    case 'review_activity_added': {
      const added = Math.max(1, transition.current.reviewActivity.count - transition.previous.reviewActivity.count);
      return `${prefix} has ${added} new review comment${added === 1 ? '' : 's'}.`;
    }
    case 'review_activity_changed':
      return `${prefix} review activity changed (${transition.current.reviewActivity.count} comment${transition.current.reviewActivity.count === 1 ? '' : 's'}).`;
  }
}

function mergeRequestMetadata(
  digest: GitLabMergeRequestDigest,
  transitionKind: GitLabMergeRequestTransitionKind | 'initial_mr_attention' | 'initial_mr_observed' | 'open_mr_reminder' | 'baseline',
): Record<string, string | number | boolean | null> {
  return {
    transitionKind,
    mergeRequestIid: digest.iid,
    mergeRequestState: digest.state,
    changesRequested: digest.changesRequested,
    approvalCount: digest.approval.approvedByCount,
    approvalsLeft: digest.approval.approvalsLeft,
    reviewerCount: digest.reviewers.count,
    unresolvedDiscussionCount: digest.unresolvedDiscussions.count,
    reviewActivityCount: digest.reviewActivity.count,
    mergeRequestUpdatedAt: digest.updatedAt || null,
    approvalsComplete: digest.approvalsComplete,
    discussionsComplete: digest.discussionsComplete,
    reviewActivityComplete: digest.reviewActivityComplete,
  };
}

function approvalSummary(digest: GitLabMergeRequestDigest): string {
  const approvals = `${digest.approval.approvedByCount} approval${digest.approval.approvedByCount === 1 ? '' : 's'}`;
  return digest.approval.approvalsLeft === null
    ? approvals
    : `${approvals}, ${digest.approval.approvalsLeft} remaining`;
}

function mergeRequestEventState(digest: GitLabMergeRequestDigest): string {
  return digest.detailedMergeStatus === 'unknown'
    ? digest.state
    : `${digest.state}/${digest.detailedMergeStatus}`;
}

function mergeRequestTransitionIsWarning(kind: GitLabMergeRequestTransitionKind): boolean {
  return kind === 'merge_request_closed'
    || kind === 'changes_requested'
    || kind === 'approval_required'
    || kind === 'unresolved_discussions_observed'
    || kind === 'unresolved_discussions_increased';
}

function updateGitLabMergeRequestReadStatus(
  session: TicketWorkSessionRecord,
  iid: number,
  input: GitLabMergeRequestReadStatusInput,
  providerUrl: string | undefined,
  log: ManagedProviderMonitorOptions['log'],
): ManagedProviderNotice | null {
  const previous = safeReadGitLabMergeRequestReadStatus(session, log);
  const next = advanceGitLabMergeRequestReadStatus(previous, input);
  if (!next.changed) { return null; }

  const status = next.status;
  let result: ManagedProviderNotice | null = null;
  if (previous || status.state !== 'complete') {
    const transitionKind = status.state === 'failed'
      ? 'provider_read_failed'
      : status.state === 'partial' ? 'provider_read_partial' : 'provider_read_recovered';
    const transitionInput: AppendTransitionInput = {
      session,
      source: 'gitlab',
      summary: mergeRequestReadStatusSummary(session.ticketKey, iid, previous, status),
      subject: { kind: 'merge-request', id: String(iid), ticketKey: session.ticketKey },
      state: `monitoring/${status.state}`,
      fingerprint: status.fingerprint,
      artifactPath: gitLabMergeRequestReadStatusPath(session.id),
      transitionKey: `mr-read:${status.generation}:${status.state}:${status.fingerprint}`,
      metadata: {
        transitionKind,
        mergeRequestIid: iid,
        readState: status.state,
        readReason: status.reason,
        readComponents: status.components.join(',') || 'none',
        readGeneration: status.generation,
      },
    };
    if (previous) {
      transitionInput.beforeState = `monitoring/${previous.state}`;
      transitionInput.beforeFingerprint = previous.fingerprint;
    }
    const event = appendTransitionOnce(transitionInput);
    if (event) {
      result = notice(
        event,
        session,
        status.state === 'complete' ? 'information' : 'warning',
        providerUrl,
        'kronos.insertGitLabContext',
      );
    }
  }
  writeGitLabMergeRequestReadStatus(session.id, status);
  return result;
}

function mergeRequestReadStatusSummary(
  ticketKey: string,
  iid: number,
  previous: GitLabMergeRequestReadStatus | null,
  current: GitLabMergeRequestReadStatus,
): string {
  const prefix = `${ticketKey} MR !${iid}`;
  if (current.state === 'complete') {
    return `${prefix} provider reads recovered and are complete.`;
  }
  if (current.state === 'failed') {
    return `${prefix} provider read failed (${readFailureLabel(current.reason)}).`;
  }
  const components = current.components.join(', ') || 'review data';
  return previous?.state === 'partial'
    ? `${prefix} partial provider-read scope changed (${components}).`
    : `${prefix} provider reads are partial (${components}).`;
}

function providerReadFailureReason(error: unknown): string {
  const message = unknownErrorMessage(error, '').toLowerCase();
  const httpMatch = /\bhttp\s+(\d{3})\b/.exec(message);
  const status = httpMatch?.[1] ? Number(httpMatch[1]) : undefined;
  if (status === 401 || status === 403) { return 'authentication'; }
  if (status === 404) { return 'not_found'; }
  if (status === 429) { return 'rate_limited'; }
  if (status !== undefined && status >= 500) { return 'provider_5xx'; }
  if (status !== undefined) { return 'provider_4xx'; }
  if (message.includes('timed out') || message.includes('timeout')) { return 'timeout'; }
  if (message.includes('safety limit') || message.includes('exceeded')) { return 'safety_limit'; }
  if (message.includes('configuration') || message.includes('missing')) { return 'configuration'; }
  if (message.includes('network')) { return 'network'; }
  return 'unavailable';
}

function readFailureLabel(reason: string): string {
  if (reason === 'authentication') { return 'authentication unavailable'; }
  if (reason === 'not_found') { return 'merge request not found'; }
  if (reason === 'rate_limited') { return 'provider rate limited'; }
  if (reason === 'provider_5xx') { return 'provider server error'; }
  if (reason === 'provider_4xx') { return 'provider request refused'; }
  if (reason === 'timeout') { return 'request timed out'; }
  if (reason === 'safety_limit') { return 'bounded read limit reached'; }
  if (reason === 'configuration') { return 'provider configuration unavailable'; }
  if (reason === 'network') { return 'network unavailable'; }
  return 'provider unavailable';
}

type ProviderReadState = 'complete' | 'partial' | 'failed';

function appendProviderReadStatusTransition(
  session: TicketWorkSessionRecord,
  provider: 'jenkins' | 'sonar',
  state: ProviderReadState,
  reason: string,
  providerUrl: string | undefined,
  components: readonly string[],
): ManagedProviderNotice | null {
  const normalizedComponents = [...new Set(components)].sort();
  const componentLabel = normalizedComponents.join(',') || 'none';
  const previous = listMonitorEvents({
    sessionId: session.id,
    source: provider,
    types: ['provider.transition'],
    limit: 2000,
  }).find(event => event.subject?.kind === 'provider-read'
    && event.subject.id === provider
    && typeof event.metadata?.['readState'] === 'string');
  const previousState = previous?.metadata?.['readState'];
  const previousReason = previous?.metadata?.['readReason'];
  const previousComponents = previous?.metadata?.['readComponents'];
  if (!previous && state === 'complete') { return null; }
  if (previousState === state && previousReason === reason && previousComponents === componentLabel) { return null; }

  const previousGeneration = previous?.metadata?.['readGeneration'];
  const generation = typeof previousGeneration === 'number' && Number.isSafeInteger(previousGeneration)
    ? Math.min(Number.MAX_SAFE_INTEGER, previousGeneration + 1)
    : 1;
  const fingerprint = deterministicReadStatusFingerprint(provider, state, reason, generation, componentLabel);
  const providerName = provider === 'jenkins' ? 'Jenkins' : 'SonarQube';
  const transitionInput: AppendTransitionInput = {
    session,
    source: provider,
    summary: state === 'complete'
      ? `${session.ticketKey} ${providerName} provider reads recovered.`
      : state === 'partial'
        ? `${session.ticketKey} ${providerName} provider reads are partial (${normalizedComponents.join(', ') || 'bounded data'}).`
        : `${session.ticketKey} ${providerName} provider read failed (${readFailureLabel(reason)}).`,
    subject: { kind: 'provider-read', id: provider, ticketKey: session.ticketKey },
    state: `monitoring/${state}`,
    fingerprint,
    artifactPath: ciMonitorSnapshotPath(session.id),
    transitionKey: `provider-read:${provider}:${generation}:${state}:${fingerprint}`,
    metadata: {
      transitionKind: state === 'complete'
        ? 'provider_read_recovered'
        : state === 'partial' ? 'provider_read_partial' : 'provider_read_failed',
      readProvider: provider,
      readState: state,
      readReason: reason,
      readComponents: componentLabel,
      readGeneration: generation,
    },
  };
  if (previous?.after?.fingerprint && typeof previousState === 'string') {
    transitionInput.beforeState = `monitoring/${previousState}`;
    transitionInput.beforeFingerprint = previous.after.fingerprint;
  }
  const event = appendTransitionOnce(transitionInput);
  return event
    ? notice(
      event,
      session,
      state === 'complete' ? 'information' : 'warning',
      providerUrl,
      'kronos.insertCiContext',
    )
    : null;
}

function deterministicReadStatusFingerprint(
  provider: 'jenkins' | 'sonar',
  state: ProviderReadState,
  reason: string,
  generation: number,
  components: string,
): string {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ provider, state, reason, generation, components }))
    .digest('hex');
}

function jenkinsIncompleteReadComponents(context: JenkinsBuildContext): string[] {
  return [
    ...(!context.completeness.buildComplete ? ['build'] : []),
    ...(context.completeness.testReport === 'partial' ? ['tests'] : []),
    ...(context.completeness.stages === 'partial' ? ['stages'] : []),
  ];
}

function sonarIncompleteReadComponents(context: SonarBranchContext): string[] {
  return [
    ...(!context.completeness.qualityGateComplete ? ['quality-gate'] : []),
    ...(!context.completeness.measuresComplete ? ['measures'] : []),
    ...(!context.completeness.issuesComplete ? ['issues'] : []),
  ];
}

function ciDigestState(digest: CiMonitorDigest): string {
  const values = [digest.jenkins?.status, digest.sonar?.gateStatus].filter((value): value is string => Boolean(value));
  return values.join(' / ') || 'observed';
}

function transitionIsFailure(kind: string): boolean {
  return kind.includes('failed')
    || kind.includes('canceled')
    || kind.includes('increased')
    || kind === 'initial_unhealthy';
}

function transitionLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}

function notice(
  event: MonitorEvent,
  session: TicketWorkSessionRecord,
  severity: ManagedProviderNotice['severity'],
  providerUrl: string | undefined,
  contextCommand: ManagedProviderNotice['contextCommand'],
): ManagedProviderNotice {
  const value: ManagedProviderNotice = { event, session, severity };
  if (providerUrl) { value.providerUrl = providerUrl; }
  if (contextCommand) { value.contextCommand = contextCommand; }
  return value;
}

export function configuredGitLabPollingTarget(
  state: KronosStateSnapshot | null,
  session: TicketWorkSessionRecord,
): ConfiguredGitLabPollingTarget | null {
  const ticket = state?.tickets[session.ticketKey];
  const binding = latestGitLabMergeRequestBinding(session);
  const ticketIid = ticket?.mr?.iid;
  const boundIid = Number(binding?.subjectId);
  const useBinding = Number.isSafeInteger(boundIid) && boundIid > 0;
  const iid = Number(useBinding ? boundIid : ticketIid);
  const config = projectConfigurationForMonitoringSession(state, session);
  const configuredProject = config.gitlab_project_id || config.gitlab_project_path;
  const catalogMatches = Number.isSafeInteger(ticketIid) && ticketIid === iid;
  const projectIdOrPath = (useBinding ? binding?.projectId : undefined)
    || (useBinding ? configuredGitLabProjectPathFromMergeRequestUrl(binding?.url, process.env) : undefined)
    || (configuredProject ? String(configuredProject) : undefined)
    || (catalogMatches ? configuredGitLabProjectPathFromMergeRequestUrl(ticket?.mr?.url, process.env) : undefined);
  if (!Number.isSafeInteger(iid) || iid <= 0 || !projectIdOrPath) { return null; }
  const providerUrl = (useBinding ? binding?.url : undefined) || (catalogMatches ? ticket?.mr?.url : undefined);
  return {
    iid,
    projectIdOrPath,
    ...(providerUrl ? { providerUrl } : {}),
  };
}

export function configuredCiPollingTargets(
  state: KronosStateSnapshot | null,
  session: TicketWorkSessionRecord,
): ConfiguredCiPollingTargets {
  const ticket = state?.tickets[session.ticketKey];
  const config = projectConfigurationForMonitoringSession(state, session);
  const jenkinsJobBinding = newestWorkSessionProviderBinding(
    session.providerBindings,
    candidate => candidate.provider === 'jenkins' && candidate.resource === 'job',
  );
  const jenkinsBuildBinding = newestWorkSessionProviderBinding(
    session.providerBindings,
    candidate => candidate.provider === 'jenkins' && candidate.resource === 'build',
  );
  const sonarBinding = newestWorkSessionProviderBinding(
    session.providerBindings,
    candidate => candidate.provider === 'sonar' && candidate.resource === 'quality-gate',
  );
  const jenkinsUrl = optionalTrimmedStringFromUnknown(config.jenkins_url)
    || jenkinsJobBinding?.url
    || ticket?.build?.url
    || jenkinsBuildBinding?.url;
  const configuredBranch = optionalTrimmedStringFromUnknown(config.sonar_branch)
    || ticket?.mr?.source_branch
    || ticket?.mr?.sourceBranch
    || ticket?.mr?.branch
    || ticket?.mr?.head_branch
    || optionalTrimmedStringFromUnknown(config.default_branch)
    || optionalTrimmedStringFromUnknown(config.base_branch);
  const configuredProjectKey = optionalTrimmedStringFromUnknown(config.sonar_project_key);
  const configuredSonar = configuredProjectKey && configuredBranch
    ? { projectKey: configuredProjectKey, branch: configuredBranch }
    : null;
  const boundProjectKey = sonarBinding?.projectId;
  const boundPrefix = boundProjectKey ? `${boundProjectKey}:` : '';
  const boundBranch = boundPrefix && sonarBinding?.subjectId.startsWith(boundPrefix)
    ? sonarBinding.subjectId.slice(boundPrefix.length).trim()
    : '';
  let sonar: ConfiguredCiPollingTargets['sonar'];
  if (configuredSonar) {
    const providerUrl = sonarDashboardUrl(configuredSonar.projectKey, configuredSonar.branch);
    sonar = { ...configuredSonar, ...(providerUrl ? { providerUrl } : {}) };
  } else if (boundProjectKey && boundBranch) {
    sonar = {
      projectKey: boundProjectKey,
      branch: boundBranch,
      ...(sonarBinding?.url ? { providerUrl: sonarBinding.url } : {}),
    };
  }
  return {
    ...(jenkinsUrl ? { jenkinsUrl } : {}),
    ...(sonar ? { sonar } : {}),
  };
}

export function configuredSonarBranch(
  state: KronosStateSnapshot | null,
  ticketKey: string,
): { projectKey: string; branch: string } | null {
  const ticket = state?.tickets[ticketKey];
  const config = projectConfigurationForTicket(state, ticket);
  const projectKey = optionalTrimmedStringFromUnknown(config?.sonar_project_key);
  const branch = configuredSonarBranchName(state, ticketKey);
  return projectKey && branch ? { projectKey, branch } : null;
}

export function configuredSonarBranchName(
  state: KronosStateSnapshot | null,
  ticketKey: string,
): string | null {
  const ticket = state?.tickets[ticketKey];
  const config = projectConfigurationForTicket(state, ticket);
  const branch = optionalTrimmedStringFromUnknown(config?.sonar_branch)
    || ticket?.mr?.source_branch
    || ticket?.mr?.sourceBranch
    || ticket?.mr?.branch
    || ticket?.mr?.head_branch
    || optionalTrimmedStringFromUnknown(config?.default_branch)
    || optionalTrimmedStringFromUnknown(config?.base_branch);
  return optionalTrimmedStringFromUnknown(branch) || null;
}

export function gitLabIncompleteMonitorComponents(
  completeness: GitLabMergeRequestMonitorSnapshot['completeness'],
): string[] {
  return [
    ...(!completeness.pipelinesComplete ? ['pipelines'] : []),
    ...(!completeness.jobsComplete ? ['jobs'] : []),
    ...(!completeness.testsComplete ? ['tests'] : []),
    ...(!completeness.notesComplete ? ['notes'] : []),
    ...(!completeness.discussionsComplete ? ['discussions'] : []),
    ...(!completeness.approvalsComplete ? ['approvals'] : []),
  ];
}
