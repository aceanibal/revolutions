class SessionArchive {
  constructor({ sessionStore }) {
    this.sessionStore = sessionStore;
  }

  async archiveSession(sessionId, reason = null) {
    if (!this.sessionStore) return;
    await this.sessionStore.closeAndArchiveSession(sessionId, Date.now(), reason);
  }
}

module.exports = {
  SessionArchive
};
