import type { KronosState as KronosStateSnapshot } from '../state/types';
import {
  gitlabRestClient,
  type GitLabMergeRequestMonitorSnapshot,
} from './gitlabRestClient';
import { jenkinsRestClient, type JenkinsBuildContext } from './jenkinsRestClient';
import { isSonarRestConfigured, sonarDashboardUrl, sonarRestClient, type SonarBranchContext } from './sonarRestClient';
import {
  compareGitLabPipelineDigests,
  gitLabPipelineStatusIsUnhealthy,
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
  jenkinsStatusIsFailure,
  jenkinsStatusIsSuccess,
  mergeCiMonitorDigest,
  normalizeCiMonitorDigest,
  sonarGateStatusIsFailure,
  sonarGateStatusIsSuccess,
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
import {
  tryAcquireManagedMonitorLease,
  type ManagedMonitorLeaseHandle,
} from './managedMonitorLease';
import {
  listWorkSessions,
  addWorkSessionProviderBinding,
  newestWorkSessionProviderBinding,
  recordWorkSessionMonitoringResult,
  workSessionRecordPath,
  type AddWorkSessionProviderBindingInput,
  type RecordWorkSessionMonitoringResultInput,
  type WorkSessionRecord,
} from './workSessionStore';
import { optionalTrimmedStringFromUnknown } from './records';
import { boundedOperationFailure } from './errorUtils';
import {
  listLocalProjects,
  localProjectReferenceKey,
  matchesLocalProject,
  readProjectGitBranch,
} from './projectCatalog';
import {
  addProjectMonitoringProviderBinding,
  ensureProjectMonitoringRecord,
  isProjectMonitoringRecord,
  projectMonitoringRecordPath,
  recordProjectMonitoringResult,
} from './projectMonitoringStore';
import {
  configuredCiPollingTargets,
  configuredGitLabPollingTarget,
  configuredGitLabProjectIdentity,
  configuredSonarBranchName,
  effectiveTicketMergeRequest,
  latestGitLabMergeRequestBinding,
  mergeRequestDiscoverySourceBranch,
  projectConfigurationForMonitoringSession,
} from './providerBindingReconciliation';
import { providerTransitionStreamKey } from './providerTransitionStreams';
import {
  appendTransitionOnce,
  deterministicEventId,
  type AppendTransitionInput,
} from './providerTransitionRecorder';
import {
  deterministicReadStatusFingerprint,
  jenkinsIncompleteReadComponents,
  providerReadFailureReason,
  readFailureLabel,
  sonarIncompleteReadComponents,
  type ProviderReadState,
} from './providerReadHealth';

export interface ManagedProviderPollResult {
  polled: number;
  transitions: number;
  failures: number;
  skipped: number;
  unconfigured: number;
  leaseUnavailable: boolean;
  leaseReason?: string;
}

export interface ManagedProviderPollNotice {
  kind: 'lease-unavailable' | 'missing-configuration' | 'failed' | 'complete';
  message: string;
  warning: boolean;
}

export function managedProviderPollNotice(result: ManagedProviderPollResult): ManagedProviderPollNotice {
  if (result.leaseUnavailable && result.polled === 0) {
    return {
      kind: 'lease-unavailable',
      message: 'Another Kronos window owns the provider-monitoring lease; no duplicate read was started. Wait for that poll or close the duplicate window, then use Poll Now.',
      warning: false,
    };
  }
  const message = `Read ${result.polled} provider context${result.polled === 1 ? '' : 's'}; recorded ${result.transitions} new attention item${result.transitions === 1 ? '' : 's'}; ${result.failures} failed; ${result.skipped} skipped; ${result.unconfigured} project or legacy session target${result.unconfigured === 1 ? '' : 's'} missing provider configuration.`;
  if (result.unconfigured > 0) { return { kind: 'missing-configuration', message, warning: true }; }
  if (result.failures > 0 || result.leaseUnavailable) { return { kind: 'failed', message, warning: true }; }
  return { kind: 'complete', message, warning: false };
}

export interface ManagedProviderNotice {
  event: MonitorEvent;
  session: WorkSessionRecord;
  severity: 'warning' | 'information';
  providerUrl?: string;
  contextCommand?:
    | 'kronos.insertGitLabContext'
    | 'kronos.insertCiContext'
    | 'kronos.insertProjectGitLabContext'
    | 'kronos.insertProjectCiContext';
  contextArgument?:
    | { ticketKey: string }
    | { projectName: string; projectPath: string };
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
type ProviderMonitoringOwner = WorkSessionRecord;

export class ManagedProviderMonitor {
  private inFlight: Promise<ManagedProviderPollResult> | undefined;
  private activeLease: ManagedMonitorLeaseHandle | undefined;
  private disposed = false;

  constructor(private readonly options: ManagedProviderMonitorOptions) {}

  poll(): Promise<ManagedProviderPollResult> {
    if (this.disposed) { return Promise.resolve(emptyResult()); }
    if (this.inFlight) { return this.inFlight; }
    const current = this.pollOnce().finally(() => {
      if (this.inFlight === current) { this.inFlight = undefined; }
    });
    this.inFlight = current;
    return current;
  }

  /** Stops future polls and immediately releases any cross-window lease still owned by this runtime. */
  dispose(): void {
    this.disposed = true;
    const lease = this.activeLease;
    this.activeLease = undefined;
    lease?.release();
  }

  private async pollOnce(): Promise<ManagedProviderPollResult> {
    const lease = tryAcquireManagedMonitorLease();
    if (!lease.acquired) {
      return { ...emptyResult(), leaseUnavailable: true, leaseReason: lease.reason || 'contended' };
    }
    if (this.disposed) {
      lease.release();
      return emptyResult();
    }
    this.activeLease = lease;

    let leaseHealthy = true;
    const renew = (): boolean => {
      if (leaseHealthy && (this.disposed || this.activeLease !== lease || !lease.renew())) {
        leaseHealthy = false;
        this.log('Managed-provider polling stopped because its cross-window lease could not be renewed.');
      }
      return leaseHealthy;
    };
    const heartbeat = setInterval(renew, LEASE_RENEWAL_MS);
    heartbeat.unref();
    let total = emptyResult();
    try {
      // A configured registered project is the canonical poll owner. Legacy
      // ticket/session monitoring remains only for work that has no registered
      // project configuration, so one provider target is never read twice.
      const state = this.options.state();
      const sessions = listWorkSessions({
        status: 'active',
        monitoringEnabled: true,
      });
      const configuredProjects = listLocalProjects(state)
        .filter(candidate => candidate.available && hasConfiguredProjectProvider(state, candidate.name));
      const projectOwners: ProviderMonitoringOwner[] = [];
      for (const project of configuredProjects) {
        try {
          projectOwners.push(ensureProjectMonitoringRecord({
            name: project.name,
            path: project.path,
            displayName: project.displayName,
            seedBindings: sessions
              .filter(session => matchesLocalProject(session, project))
              .flatMap(session => session.providerBindings),
          }));
        } catch (error: unknown) {
          total.failures += 1;
          this.log(
            `Could not prepare automatic provider polling for ${project.displayName}.`,
            boundedOperationFailure(error, 'Project monitoring state is unavailable.').display,
          );
        }
      }
      const monitoredProjects = new Set<string>();
      const legacyOwners = sessions.map(monitorableWorkSession)
        .filter((candidate): candidate is ProviderMonitoringOwner => Boolean(candidate))
        .filter(candidate => !configuredProjects.some(project => matchesLocalProject(candidate, project)))
        .filter(candidate => {
          const projectKey = localProjectReferenceKey(candidate);
          if (!projectKey || !monitoredProjects.has(projectKey)) {
            if (projectKey) { monitoredProjects.add(projectKey); }
            return true;
          }
          return false;
        });
      for (const session of [...projectOwners, ...legacyOwners]) {
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
        if (!hasProviderTarget) { sessionResult.unconfigured += 1; }
        try {
          const localMonitoringEvent = appendLocalMonitoringAttentionTransition(
            session,
            sessionResult.unconfigured > 0,
          );
          if (localMonitoringEvent) { sessionResult.transitions += 1; }
        } catch (error: unknown) {
          this.log(
            `Could not persist local monitoring readiness for ${monitoringOwnerLabel(session)}.`,
            boundedOperationFailure(error, 'Monitoring readiness write failed.').display,
          );
        }
        const summary = hasProviderTarget
          ? `Polled ${sessionResult.polled} provider context${sessionResult.polled === 1 ? '' : 's'}; ${sessionResult.failures} failed; ${sessionResult.skipped} skipped; ${sessionResult.unconfigured} missing configuration.`
          : 'No GitLab, Jenkins, or SonarQube provider is configured for this monitoring owner.';
        try {
          recordMonitoringResult(session, {
            polled: sessionResult.polled,
            transitions: sessionResult.transitions,
            failures: sessionResult.failures,
            skipped: sessionResult.skipped,
            attemptedAt: new Date().toISOString(),
            summary,
          });
        } catch (error: unknown) {
          this.log(`Could not persist monitoring readiness for ${monitoringOwnerLabel(session)}.`, boundedOperationFailure(error, 'Monitoring state write failed.').display);
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
      if (this.activeLease === lease) {
        this.activeLease = undefined;
        if (!lease.release()) { this.log('Managed-provider polling lease was no longer owned at release.'); }
      }
    }
  }

  private async pollGitLab(
    session: ProviderMonitoringOwner,
    retainLease: () => boolean,
    followFinishedTarget = true,
  ): Promise<ManagedProviderPollResult> {
    const binding = latestGitLabMergeRequestBinding(session);
    const state = this.options.state();
    const ticket = session.ticketKey ? state?.tickets[session.ticketKey] : undefined;
    const previousMr = safeReadGitLabMergeRequestBaseline(session, this.options.log);
    const config = projectConfigurationForMonitoringSession(state, session);
    const configuredProject = configuredGitLabProjectIdentity(config);
    const sourceBranch = mergeRequestDiscoverySourceBranch(
      ticket,
      session.projectPath ? readProjectGitBranch(session.projectPath)?.branch : undefined,
    );
    let target = configuredGitLabPollingTarget(state, session);
    let discoveryDetail: string | undefined;
    const targetBaseline = target && previousMr?.iid === target.iid ? previousMr : undefined;
    const registeredProjectBranchChanged = Boolean(
      isProjectMonitoringRecord(session)
        && sourceBranch
        && targetBaseline?.sourceBranch
        && targetBaseline.sourceBranch !== sourceBranch,
    );
    const registeredProjectTargetFinished = Boolean(
      isProjectMonitoringRecord(session)
        && targetBaseline
        && mergeRequestDigestIsTerminal(targetBaseline),
    );
    if (!target || registeredProjectBranchChanged || registeredProjectTargetFinished) {
      if (configuredProject) {
        try {
          const discovery = await gitlabRestClient.discoverOpenMergeRequest({
            projectIdOrPath: configuredProject,
            ...(session.ticketKey ? { ticketKey: session.ticketKey } : {}),
            ...(sourceBranch ? { sourceBranch } : {}),
          });
          if (discovery.match) {
            target = {
              iid: discovery.match.iid,
              projectIdOrPath: configuredProject,
              ...(discovery.match.webUrl ? { providerUrl: discovery.match.webUrl } : {}),
            };
            discoveryDetail = `Matched automatically by ${discovery.strategy === 'source-branch'
              ? 'current branch'
              : discovery.strategy === 'ticket-key' ? 'ticket key' : 'the registered project open-MR list'}.`;
          } else {
            const detail = discovery.ambiguous
              ? `Found ${discovery.candidateCount} possible open merge requests; Kronos will not guess.`
              : 'No unique open merge request matched the current branch, registered project, or ticket key yet.';
            this.log(`GitLab monitoring is waiting for ${monitoringOwnerLabel(session)}.`, detail);
            if (!target || registeredProjectTargetFinished) {
              return { ...emptyResult(), skipped: 1 };
            }
          }
        } catch (error: unknown) {
          this.log(`GitLab MR discovery failed for ${monitoringOwnerLabel(session)}.`, boundedOperationFailure(error, 'GitLab MR discovery failed.').display);
          if (!target || registeredProjectTargetFinished) {
            return { ...emptyResult(), failures: 1 };
          }
        }
      }
    }
    if (!target) {
      if (!binding && !ticket?.mr?.iid) { return emptyResult(); }
      const candidateIid = Number(binding?.subjectId || ticket?.mr?.iid);
      const detail = Number.isSafeInteger(candidateIid) && candidateIid > 0
        ? 'No GitLab project ID or path is configured for the current merge request.'
        : 'The current merge request has no valid IID.';
      this.log(`Skipped GitLab monitoring for ${monitoringOwnerLabel(session)}.`, detail);
      return { ...emptyResult(), skipped: 1, unconfigured: 1 };
    }
    const { iid, projectIdOrPath, providerUrl } = target;
    try {
      session = reconcileProviderBinding(session, {
        provider: 'gitlab',
        resource: 'merge-request',
        subjectId: String(iid),
        projectId: projectIdOrPath,
        ...(providerUrl ? { url: providerUrl } : {}),
      }, Boolean(discoveryDetail));
      if (discoveryDetail) {
        this.log(
          `GitLab monitoring found MR !${iid} for ${monitoringOwnerLabel(session)}.`,
          `${discoveryDetail} The durable local session binding is ready.`,
        );
      }
    } catch (error: unknown) {
      this.log(
        `GitLab monitoring could not bind MR !${iid} to ${monitoringOwnerLabel(session)}.`,
        boundedOperationFailure(error, 'GitLab session binding write failed.').display,
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
      this.log(`GitLab monitoring failed for ${monitoringOwnerLabel(session)}.`, boundedOperationFailure(error, 'GitLab monitoring failed.').display);
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
          `Could not persist GitLab read failure state for ${monitoringOwnerLabel(session)}.`,
          boundedOperationFailure(statusError, 'GitLab read failure state write failed.').display,
        );
      }
      return failureResult;
    }
    const incompleteComponents = gitLabIncompleteMonitorComponents(snapshot.completeness);
    const providerPartial = incompleteComponents.length > 0;
    if (providerPartial) {
      this.log(
        `GitLab provider monitoring was partial for ${monitoringOwnerLabel(session)}.`,
        snapshot.completeness.warnings.join(' ') || 'One or more bounded provider reads were incomplete.',
      );
    }
    const result = { ...emptyResult(), polled: 1, skipped: providerPartial ? 1 : 0 };
    if (!retainLease()) { return leaseLost(result); }

    const notices: ManagedProviderNotice[] = [];
    let stateFailures = 0;
    let finishedProjectTargetObserved = false;
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
        `GitLab read-status monitoring failed for ${monitoringOwnerLabel(session)}.`,
        boundedOperationFailure(error, 'GitLab read-status monitoring failed.').display,
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
        const comparablePreviousMr = previousMr?.iid === observedMr.iid ? previousMr : undefined;
        const mrDigest = comparablePreviousMr
          ? mergeGitLabMergeRequestDigest(comparablePreviousMr, observedMr) || observedMr
          : observedMr;
        const mrSnapshotPath = gitLabMergeRequestMonitorSnapshotPath(session.id);
        if (!retainLease()) {
          for (const item of notices) { this.options.notify?.(item); }
          return leaseLost({ ...result, transitions: notices.length, failures: stateFailures });
        }
        if (!comparablePreviousMr) {
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
          for (const transition of compareGitLabMergeRequestDigests(comparablePreviousMr, mrDigest)) {
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
        finishedProjectTargetObserved = Boolean(
          isProjectMonitoringRecord(session) && mergeRequestDigestIsTerminal(mrDigest),
        );
        const projectionState = this.options.state();
        for (const ticketKey of monitoringTicketKeys(projectionState, session)) {
          const currentTicket = projectionState?.tickets[ticketKey];
          if (!currentTicket) { continue; }
          const projected = effectiveTicketMergeRequest(currentTicket, session, mrDigest);
          if (projected) {
            this.options.projectTicketProviderState?.(ticketKey, { mr: projected });
          }
        }
      }
    } catch (error: unknown) {
      stateFailures += 1;
      this.log(
        `GitLab merge-request monitoring state failed for ${monitoringOwnerLabel(session)}.`,
        boundedOperationFailure(error, 'GitLab merge-request monitoring state failed.').display,
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
        `GitLab pipeline monitoring state failed for ${monitoringOwnerLabel(session)}.`,
        boundedOperationFailure(error, 'GitLab pipeline monitoring state failed.').display,
      );
    }

    for (const item of notices) { this.options.notify?.(item); }
    const completed = { ...result, transitions: notices.length, failures: stateFailures };
    if (followFinishedTarget && finishedProjectTargetObserved && configuredProject) {
      if (!retainLease()) { return leaseLost(completed); }
      return combine(completed, await this.pollGitLab(session, retainLease, false));
    }
    return completed;
  }

  private async pollCi(
    session: ProviderMonitoringOwner,
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
        `CI monitoring could not persist provider bindings for ${monitoringOwnerLabel(session)}.`,
        boundedOperationFailure(error, 'CI session binding write failed.').display,
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
        const jenkinsBranch = targets.jenkinsBranch
          || sonarTarget?.branch
          || (session.ticketKey ? configuredSonarBranchName(state, session.ticketKey) : null)
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
        for (const ticketKey of monitoringTicketKeys(state, session)) {
          this.options.projectTicketProviderState?.(ticketKey, {
            build: {
              number: jenkins.build.number,
              status: jenkins.build.status,
              url: jenkins.build.url || jenkins.jobOrBuildUrl || jenkinsUrl,
            },
          });
        }
        const discoveredProjectKey = jenkins.sonarProjectKey
          || (!sonarTarget && isSonarRestConfigured() ? sonarProjectKeyHeuristic(state, session) : undefined);
        if (discoveredProjectKey) {
          const branch = jenkins.sonarBranch
            || sonarTarget?.branch
            || (session.ticketKey ? configuredSonarBranchName(state, session.ticketKey) : null);
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
              `Jenkins discovered SonarQube project ${discoveredProjectKey} for ${monitoringOwnerLabel(session)}.`,
              `${jenkins.sonarProjectKey ? 'Kronos bound the literal pipeline configuration' : 'Kronos used the registered repository-name heuristic'} to branch ${branch}.`,
            );
          }
        }
      } catch (error: unknown) {
        jenkinsReadFailure = providerReadFailureReason(error);
        result.failures += 1;
        this.log(`Jenkins monitoring failed for ${monitoringOwnerLabel(session)}.`, boundedOperationFailure(error, 'Jenkins monitoring failed.').display);
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
          `Jenkins read-status monitoring failed for ${monitoringOwnerLabel(session)}.`,
          boundedOperationFailure(error, 'Jenkins read-status monitoring failed.').display,
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
        this.log(`SonarQube monitoring failed for ${monitoringOwnerLabel(session)}.`, boundedOperationFailure(error, 'SonarQube monitoring failed.').display);
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
          {
            projectKey: sonar?.projectKey || sonarTarget.projectKey,
            branch: sonar?.branch || sonarTarget.branch,
          },
        );
        if (readNotice) { notices.push(readNotice); }
      } catch (error: unknown) {
        result.failures += 1;
        this.log(
          `SonarQube read-status monitoring failed for ${monitoringOwnerLabel(session)}.`,
          boundedOperationFailure(error, 'SonarQube read-status monitoring failed.').display,
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

      notices.push(...initialCiNotices(session, digest, snapshotPath, previous));
      if (!previous) {
        appendBaselineOnce(session, 'kronos', 'ci-monitor', monitoringOwnerSubjectId(session), ciDigestState(digest), digest.fingerprint, snapshotPath, {
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
      this.log(`CI monitoring state failed for ${monitoringOwnerLabel(session)}.`, boundedOperationFailure(error, 'CI monitoring state failed.').display);
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

function hasConfiguredProjectProvider(
  state: KronosStateSnapshot | null,
  projectName: string,
): boolean {
  const config = state?.projects[projectName]?.config;
  return Boolean(
    config?.gitlab_project_id
      || config?.gitlab_project_path
      || config?.jenkins_url
      || config?.sonar_project_key
      || config?.branch_profiles?.some(profile => profile.jenkins_url || profile.sonar_project_key),
  );
}

function monitoringOwnerLabel(session: ProviderMonitoringOwner): string {
  return session.ticketKey || session.projectName || session.title;
}

function monitoringOwnerSubjectId(session: ProviderMonitoringOwner): string {
  return session.ticketKey || session.projectName || session.id;
}

function monitoringSubject(
  session: ProviderMonitoringOwner,
  kind: string,
  id: string,
): MonitorEventSubject {
  return {
    kind,
    id,
    ...(session.projectName ? { project: session.projectName } : {}),
    ...(session.ticketKey ? { ticketKey: session.ticketKey } : {}),
  };
}

function monitoringOwnerRecordPath(session: ProviderMonitoringOwner): string {
  return isProjectMonitoringRecord(session)
    ? projectMonitoringRecordPath(session.id)
    : workSessionRecordPath(session.id);
}

function monitoringProjectName(
  state: KronosStateSnapshot | null,
  session: ProviderMonitoringOwner,
): string | undefined {
  return session.projectName
    || (session.ticketKey ? state?.tickets[session.ticketKey]?.linked_local_project : undefined);
}

/** Provider state reaches Jira only through an explicit local-project link. */
function monitoringTicketKeys(
  state: KronosStateSnapshot | null,
  session: ProviderMonitoringOwner,
): string[] {
  if (session.ticketKey) { return [session.ticketKey]; }
  const projectName = monitoringProjectName(state, session);
  if (!projectName || !state) { return []; }
  return Object.entries(state.tickets)
    .filter(([, ticket]) => ticket.linked_local_project === projectName)
    .map(([ticketKey]) => ticketKey);
}

function sonarProjectKeyHeuristic(
  state: KronosStateSnapshot | null,
  session: ProviderMonitoringOwner,
): string | undefined {
  const config = projectConfigurationForMonitoringSession(state, session);
  const candidate = optionalTrimmedStringFromUnknown(config.repo_name)
    || optionalTrimmedStringFromUnknown(session.projectName);
  return candidate && /^[A-Za-z0-9_.:-]{1,400}$/.test(candidate) ? candidate : undefined;
}

function reconcileProviderBinding(
  session: ProviderMonitoringOwner,
  input: AddWorkSessionProviderBindingInput,
  refreshExisting = false,
): ProviderMonitoringOwner {
  const current = newestProviderBinding(session, input.provider, input.resource, input.subjectId);
  const projectMatches = input.projectId === undefined || current?.projectId === input.projectId;
  const urlMatches = input.url === undefined || current?.url === input.url;
  const idMatches = input.id === undefined || current?.id === input.id;
  if (current && projectMatches && urlMatches && idMatches && !refreshExisting) { return session; }
  const update = {
    ...input,
    ...(!input.id && current ? { id: current.id } : {}),
  };
  if (isProjectMonitoringRecord(session)) {
    return addProjectMonitoringProviderBinding(session.id, update);
  }
  const monitored = monitorableWorkSession(addWorkSessionProviderBinding(session.id, update));
  if (!monitored) { throw new Error('Legacy Session polling requires an explicit Jira context.'); }
  return monitored;
}

function newestProviderBinding(
  session: ProviderMonitoringOwner,
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
  return { polled: 0, transitions: 0, failures: 0, skipped: 0, unconfigured: 0, leaseUnavailable: false };
}

function monitorableWorkSession(session: WorkSessionRecord): ProviderMonitoringOwner | undefined {
  const ticketKey = session.kind === 'ticket' ? session.ticketKey : session.ticketKeys[0];
  return ticketKey ? { ...session, ticketKey } : undefined;
}

function recordMonitoringResult(
  owner: ProviderMonitoringOwner,
  input: RecordWorkSessionMonitoringResultInput,
): ProviderMonitoringOwner {
  return isProjectMonitoringRecord(owner)
    ? recordProjectMonitoringResult(owner.id, input)
    : recordWorkSessionMonitoringResult(owner.id, input);
}

function combine(left: ManagedProviderPollResult, right: ManagedProviderPollResult): ManagedProviderPollResult {
  const value: ManagedProviderPollResult = {
    polled: left.polled + right.polled,
    transitions: left.transitions + right.transitions,
    failures: left.failures + right.failures,
    skipped: left.skipped + right.skipped,
    unconfigured: left.unconfigured + right.unconfigured,
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
  session: ProviderMonitoringOwner,
  log: ManagedProviderMonitorOptions['log'],
): GitLabPipelineDigest | null {
  try {
    return readGitLabPipelineMonitorSnapshot(session.id);
  } catch (error: unknown) {
    log?.(`Ignored an invalid GitLab baseline for ${monitoringOwnerLabel(session)}.`, boundedOperationFailure(error, 'Invalid baseline.').display);
    return null;
  }
}

function safeReadGitLabMergeRequestBaseline(
  session: ProviderMonitoringOwner,
  log: ManagedProviderMonitorOptions['log'],
): GitLabMergeRequestDigest | null {
  try {
    return readGitLabMergeRequestMonitorSnapshot(session.id);
  } catch (error: unknown) {
    log?.(
      `Ignored an invalid GitLab merge-request baseline for ${monitoringOwnerLabel(session)}.`,
      boundedOperationFailure(error, 'Invalid merge-request baseline.').display,
    );
    return null;
  }
}

function safeReadGitLabMergeRequestReadStatus(
  session: ProviderMonitoringOwner,
  log: ManagedProviderMonitorOptions['log'],
): GitLabMergeRequestReadStatus | null {
  try {
    return readGitLabMergeRequestReadStatus(session.id);
  } catch (error: unknown) {
    log?.(
      `Ignored an invalid GitLab read-status baseline for ${monitoringOwnerLabel(session)}.`,
      boundedOperationFailure(error, 'Invalid GitLab read-status baseline.').display,
    );
    return null;
  }
}

function safeReadCiBaseline(
  session: ProviderMonitoringOwner,
  log: ManagedProviderMonitorOptions['log'],
): CiMonitorDigest | null {
  try {
    return readCiMonitorSnapshot(session.id);
  } catch (error: unknown) {
    log?.(`Ignored an invalid CI baseline for ${monitoringOwnerLabel(session)}.`, boundedOperationFailure(error, 'Invalid baseline.').display);
    return null;
  }
}

function appendBaselineOnce(
  session: ProviderMonitoringOwner,
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
  const subject = monitoringSubject(session, kind, subjectId);
  appendMonitorEvent({
    id,
    sessionId: session.id,
    type: 'provider.baseline',
    source,
    summary: `${monitoringOwnerLabel(session)} ${kind} baseline recorded.`,
    subject,
    after: { state, fingerprint },
    artifactPath,
    metadata: {
      ...metadata,
      transitionStreamKey: providerTransitionStreamKey({
        sessionId: session.id,
        source,
        subject,
        metadata,
      }, session),
    },
  });
}

/**
 * Gives missing local provider setup one current Attention stream. Repeated
 * polls stay quiet; recovery replaces the blocker; a later regression is a
 * new transition while every earlier state remains in the audit ledger.
 */
export function appendLocalMonitoringAttentionTransition(
  session: ProviderMonitoringOwner,
  blocked: boolean,
): MonitorEvent | null {
  const subject = monitoringSubject(session, 'monitoring-blocker', 'provider-configuration');
  const previous = listMonitorEvents({
    sessionId: session.id,
    source: 'kronos',
    types: ['provider.transition'],
    limit: 2000,
  }).find(event => event.subject?.kind === subject.kind && event.subject.id === subject.id);
  const state = blocked ? 'blocked' : 'ready';
  const previousState = typeof previous?.metadata?.['monitoringState'] === 'string'
    ? previous.metadata['monitoringState']
    : undefined;
  if ((!previous && !blocked) || previousState === state) { return null; }
  const previousGeneration = previous?.metadata?.['monitoringGeneration'];
  const generation = typeof previousGeneration === 'number' && Number.isSafeInteger(previousGeneration)
    ? Math.min(Number.MAX_SAFE_INTEGER, previousGeneration + 1)
    : 1;
  const transitionKind = blocked ? 'monitoring_blocked' : 'monitoring_recovered';
  return appendTransitionOnce({
    session,
    source: 'kronos',
    summary: blocked
      ? `${monitoringOwnerLabel(session)} monitoring is blocked until GitLab, Jenkins, or SonarQube is configured for this project.`
      : `${monitoringOwnerLabel(session)} local provider monitoring setup recovered and is ready.`,
    subject,
    state: `monitoring/${state}`,
    fingerprint: `${state}-${generation}`,
    ...(previous?.after?.state && previous.after.fingerprint
      ? { beforeState: previous.after.state, beforeFingerprint: previous.after.fingerprint }
      : {}),
    artifactPath: monitoringOwnerRecordPath(session),
    transitionKey: `local-monitoring:${generation}:${transitionKind}`,
    metadata: {
      transitionKind,
      monitoringState: state,
      monitoringReason: blocked ? 'provider_configuration_missing' : 'provider_configuration_ready',
      monitoringGeneration: generation,
    },
  });
}

function initialGitLabNotice(
  session: ProviderMonitoringOwner,
  iid: number,
  digest: GitLabPipelineDigest,
  artifactPath: string,
): ManagedProviderNotice | null {
  if (!gitLabDigestUnhealthy(digest)) { return null; }
  const summary = `${monitoringOwnerLabel(session)} was first observed with pipeline ${digest.id} unhealthy (${digest.status}; ${digest.failedJobs.length} failed blocking job${digest.failedJobs.length === 1 ? '' : 's'}; ${digest.tests.failed + digest.tests.error} failed/error test${digest.tests.failed + digest.tests.error === 1 ? '' : 's'}).`;
  const event = appendTransitionOnce({
    session,
    source: 'gitlab',
    summary,
    subject: monitoringSubject(session, 'pipeline', String(digest.id)),
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
  session: ProviderMonitoringOwner,
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
    ? `${monitoringOwnerLabel(session)} MR !${digest.iid} needs attention: ${reasons.join('; ')}.`
    : `${monitoringOwnerLabel(session)} MR !${digest.iid} first observed (${mergeRequestEventState(digest)}).`;
  const event = appendTransitionOnce({
    session,
    source: 'gitlab',
    summary,
    subject: monitoringSubject(session, 'merge-request', String(digest.iid)),
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
  session: ProviderMonitoringOwner,
  digest: CiMonitorDigest,
  artifactPath: string,
  previous?: CiMonitorDigest | null,
): ManagedProviderNotice[] {
  const notices: ManagedProviderNotice[] = [];
  const jenkins = previous?.jenkins ? undefined : digest.jenkins;
  const jenkinsUnhealthy = Boolean(jenkins && (jenkinsStatusIsFailure(jenkins.status)
    || jenkins.failedTestCount > 0
    || jenkins.failedStageNames.length > 0));
  const jenkinsHealthy = Boolean(jenkins
    && !jenkins.building
    && jenkinsStatusIsSuccess(jenkins.status)
    && !jenkinsUnhealthy);
  if (jenkins && (jenkinsHealthy || jenkinsUnhealthy)) {
    const healthy = jenkinsHealthy;
    const summary = healthy
      ? `${monitoringOwnerLabel(session)} was first observed with healthy Jenkins build ${jenkins.buildNumber} (${jenkins.status}).`
      : `${monitoringOwnerLabel(session)} was first observed with Jenkins build ${jenkins.buildNumber} unhealthy (${jenkins.status}; ${jenkins.failedTestCount} failed test${jenkins.failedTestCount === 1 ? '' : 's'}; ${jenkins.failedStageNames.length} failed stage${jenkins.failedStageNames.length === 1 ? '' : 's'}).`;
    const event = appendTransitionOnce({
      session,
      source: 'jenkins',
      summary,
      subject: monitoringSubject(session, 'build', String(jenkins.buildNumber)),
      state: jenkins.status,
      fingerprint: jenkins.fingerprint,
      artifactPath,
      transitionKey: `initial-${healthy ? 'healthy' : 'unhealthy'}-build-${jenkins.buildNumber}`,
      metadata: {
        transitionKind: healthy ? 'initial_healthy' : 'initial_unhealthy',
        buildNumber: jenkins.buildNumber,
        failedTestCount: jenkins.failedTestCount,
        failedStageCount: jenkins.failedStageNames.length,
      },
    });
    if (event) {
      notices.push(notice(
        event,
        session,
        healthy ? 'information' : 'warning',
        jenkins.buildUrl,
        'kronos.insertCiContext',
      ));
    }
  }
  const currentSonar = digest.sonar;
  const previousSonar = previous?.sonar;
  const sonarIdentityChanged = Boolean(currentSonar && previousSonar
    && (currentSonar.projectKey !== previousSonar.projectKey || currentSonar.branch !== previousSonar.branch));
  const firstHealthyAvailableGate = Boolean(currentSonar && previousSonar
    && !sonarIdentityChanged
    && !previousSonar.gateAvailable
    && currentSonar.gateAvailable
    && sonarGateStatusIsSuccess(currentSonar.gateStatus));
  const sonar = !previousSonar || sonarIdentityChanged || firstHealthyAvailableGate
    ? currentSonar
    : undefined;
  const sonarHealthy = Boolean(sonar?.gateAvailable && sonarGateStatusIsSuccess(sonar.gateStatus));
  const sonarUnhealthy = Boolean(sonar?.gateAvailable && sonarGateStatusIsFailure(sonar.gateStatus));
  if (sonar && (sonarHealthy || sonarUnhealthy)) {
    const healthy = sonarHealthy;
    const summary = healthy
      ? `${monitoringOwnerLabel(session)} was first observed with a healthy SonarQube quality gate (${sonar.gateStatus}; ${sonar.unresolvedIssueCount} unresolved issue${sonar.unresolvedIssueCount === 1 ? '' : 's'}).`
      : `${monitoringOwnerLabel(session)} was first observed with SonarQube quality gate ${sonar.gateStatus} (${sonar.unresolvedIssueCount} unresolved issue${sonar.unresolvedIssueCount === 1 ? '' : 's'}).`;
    const event = appendTransitionOnce({
      session,
      source: 'sonar',
      summary,
      subject: monitoringSubject(session, 'quality-gate', `${sonar.projectKey}:${sonar.branch}`),
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
  session: ProviderMonitoringOwner,
  iid: number,
  transition: GitLabPipelineTransition,
  artifactPath: string,
  url: string | undefined,
): ManagedProviderNotice | null {
  const summary = `${monitoringOwnerLabel(session)} pipeline ${transition.pipelineId}: ${transitionLabel(transition.kind)} (${transition.currentStatus}).`;
  const event = appendTransitionOnce({
    session,
    source: 'gitlab',
    summary,
    subject: monitoringSubject(session, 'pipeline', String(transition.pipelineId)),
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
  session: ProviderMonitoringOwner,
  transition: GitLabMergeRequestTransition,
  artifactPath: string,
  providerUrl: string | undefined,
): ManagedProviderNotice | null {
  const digest = transition.current;
  const event = appendTransitionOnce({
    session,
    source: 'gitlab',
    summary: mergeRequestTransitionSummary(monitoringOwnerLabel(session), transition),
    subject: monitoringSubject(session, 'merge-request', String(digest.iid)),
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
  session: ProviderMonitoringOwner,
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
  const reminderSubject = monitoringSubject(session, 'merge-request', String(digest.iid));
  const reminderMetadata = mergeRequestMetadata(digest, 'open_mr_reminder');
  const reminderStreamKey = providerTransitionStreamKey({
    sessionId: session.id,
    source: 'gitlab',
    subject: reminderSubject,
    metadata: reminderMetadata,
  }, session);
  const latestMergeRequestEvent = recent.find(event => event.type === 'provider.transition'
    && providerTransitionStreamKey(event, session) === reminderStreamKey);
  if (!latestMergeRequestEvent) { return null; }
  const acknowledgement = recent.find(event => event.type === 'notification.acknowledged'
    && event.metadata?.['acknowledgedEventId'] === latestMergeRequestEvent.id);
  if (!acknowledgement) { return null; }
  const needsAttention = gitLabMergeRequestNeedsAttention(digest);
  const event = appendTransitionOnce({
    session,
    source: 'gitlab',
    summary: needsAttention
      ? `${monitoringOwnerLabel(session)} MR !${digest.iid} remains open and still needs attention after being cleared.`
      : `${monitoringOwnerLabel(session)} MR !${digest.iid} remains open after being cleared from Attention.`,
    subject: reminderSubject,
    state: mergeRequestEventState(digest),
    fingerprint: digest.fingerprint,
    artifactPath,
    transitionKey: `open-mr-reminder:${acknowledgement.id}`,
    metadata: {
      ...reminderMetadata,
      reminderAfterAcknowledgementId: acknowledgement.id,
    },
  });
  return event
    ? notice(event, session, needsAttention ? 'warning' : 'information', providerUrl, 'kronos.insertGitLabContext')
    : null;
}

function appendCiTransitionOnce(
  session: ProviderMonitoringOwner,
  transition: CiMonitorTransition,
  artifactPath: string,
): ManagedProviderNotice | null {
  const source: MonitorEventSource = transition.provider === 'jenkins' ? 'jenkins' : 'sonar';
  const subject = transition.provider === 'jenkins'
    ? monitoringSubject(session, 'build', String(transition.buildNumber))
    : monitoringSubject(session, 'quality-gate', `${transition.projectKey}:${transition.branch}`);
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
    summary: `${monitoringOwnerLabel(session)} ${transition.provider === 'jenkins' ? 'Jenkins' : 'SonarQube'}: ${transitionLabel(transition.kind)} (${state}).`,
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

function gitLabDigestUnhealthy(digest: GitLabPipelineDigest): boolean {
  return gitLabPipelineStatusIsUnhealthy(digest.status)
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

function mergeRequestDigestIsTerminal(digest: GitLabMergeRequestDigest): boolean {
  return digest.state === 'merged' || digest.state === 'closed';
}

function mergeRequestTransitionIsWarning(kind: GitLabMergeRequestTransitionKind): boolean {
  return kind === 'merge_request_closed'
    || kind === 'changes_requested'
    || kind === 'approval_required'
    || kind === 'unresolved_discussions_observed'
    || kind === 'unresolved_discussions_increased';
}

function updateGitLabMergeRequestReadStatus(
  session: ProviderMonitoringOwner,
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
      summary: mergeRequestReadStatusSummary(monitoringOwnerLabel(session), iid, previous, status),
      subject: monitoringSubject(session, 'merge-request', String(iid)),
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

function appendProviderReadStatusTransition(
  session: ProviderMonitoringOwner,
  provider: 'jenkins' | 'sonar',
  state: ProviderReadState,
  reason: string,
  providerUrl: string | undefined,
  components: readonly string[],
  resourceIdentity: { projectKey?: string; branch?: string } = {},
): ManagedProviderNotice | null {
  const normalizedComponents = [...new Set(components)].sort();
  const componentLabel = normalizedComponents.join(',') || 'none';
  const subjectId = provider;
  const previous = listMonitorEvents({
    sessionId: session.id,
    source: provider,
    types: ['provider.transition'],
    limit: 2000,
  }).find(event => event.subject?.kind === 'provider-read'
    && event.subject.id === subjectId
    && (provider !== 'sonar'
      || (event.metadata?.['projectKey'] === resourceIdentity.projectKey
        && event.metadata?.['branch'] === resourceIdentity.branch)
      || (event.metadata?.['projectKey'] === undefined
        && event.metadata?.['branch'] === undefined))
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
      ? `${monitoringOwnerLabel(session)} ${providerName} provider reads recovered.`
      : state === 'partial'
        ? `${monitoringOwnerLabel(session)} ${providerName} provider reads are partial (${normalizedComponents.join(', ') || 'bounded data'}).`
        : `${monitoringOwnerLabel(session)} ${providerName} provider read failed (${readFailureLabel(reason)}).`,
    subject: monitoringSubject(session, 'provider-read', subjectId),
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
      ...(resourceIdentity.projectKey ? { projectKey: resourceIdentity.projectKey } : {}),
      ...(resourceIdentity.branch ? { branch: resourceIdentity.branch } : {}),
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
  session: ProviderMonitoringOwner,
  severity: ManagedProviderNotice['severity'],
  providerUrl: string | undefined,
  contextCommand: 'kronos.insertGitLabContext' | 'kronos.insertCiContext' | undefined,
): ManagedProviderNotice {
  const value: ManagedProviderNotice = { event, session, severity };
  if (providerUrl) { value.providerUrl = providerUrl; }
  if (contextCommand && session.ticketKey) {
    value.contextCommand = contextCommand;
    value.contextArgument = { ticketKey: session.ticketKey };
  } else if (contextCommand && isProjectMonitoringRecord(session) && session.projectName && session.projectPath) {
    value.contextCommand = contextCommand === 'kronos.insertGitLabContext'
      ? 'kronos.insertProjectGitLabContext'
      : 'kronos.insertProjectCiContext';
    value.contextArgument = { projectName: session.projectName, projectPath: session.projectPath };
  }
  return value;
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
