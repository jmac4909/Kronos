function normalizeRepositoryText(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Repository text must be a string.');
  }
  return value.replace(/\r\n?/g, '\n');
}

module.exports = { normalizeRepositoryText };
