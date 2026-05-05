/**
 * Agent Harness IPC Handlers
 *
 * DB-only bridge for model profile persistence. Profile detection and the
 * master loop run in the renderer; these handlers read/write the
 * model_harness_profiles table so profiles survive across sessions.
 */

function setupAgentHarnessHandlers(ipcMain, _mainWindow, _store, db) {
  // Get stored profile (and any user overrides) by model name.
  ipcMain.handle('agent:harness:getProfile', async (_, { modelName } = {}) => {
    if (!db || !modelName) return null;
    try {
      const stmt = db.prepare('SELECT * FROM model_harness_profiles WHERE id = ?');
      stmt.bind([String(modelName)]);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      if (!row) return null;
      const profile = row.profile_json ? JSON.parse(row.profile_json) : null;
      const overrides = row.overrides_json ? JSON.parse(row.overrides_json) : null;
      if (!profile) return null;
      return overrides ? { ...profile, ...overrides } : profile;
    } catch (error) {
      console.error('[IPC:AgentHarness] getProfile error:', error?.message);
      return null;
    }
  });

  // Upsert a detected/updated profile by profile.id.
  ipcMain.handle('agent:harness:saveProfile', async (_, { profile } = {}) => {
    if (!db || !profile?.id) return { success: false, error: 'Missing profile or profile.id' };
    try {
      const profileJson = JSON.stringify(profile);
      const digest = profile.digest ?? null;
      db.run(
        `INSERT INTO model_harness_profiles (id, digest, profile_json, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           digest = excluded.digest,
           profile_json = excluded.profile_json,
           updated_at = CURRENT_TIMESTAMP`,
        [String(profile.id), digest, profileJson],
      );
      return { success: true };
    } catch (error) {
      console.error('[IPC:AgentHarness] saveProfile error:', error?.message);
      return { success: false, error: error?.message };
    }
  });

  // Upsert only the user overrides for a model, leaving profile_json intact.
  ipcMain.handle('agent:harness:saveOverride', async (_, { modelName, overrides } = {}) => {
    if (!db || !modelName) return { success: false, error: 'Missing modelName' };
    try {
      const overridesJson = JSON.stringify(overrides ?? {});
      // Ensure a stub row exists so the overrides have somewhere to live.
      db.run(
        `INSERT INTO model_harness_profiles (id, digest, profile_json, overrides_json, updated_at)
         VALUES (?, NULL, '{}', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           overrides_json = excluded.overrides_json,
           updated_at = CURRENT_TIMESTAMP`,
        [String(modelName), overridesJson],
      );
      return { success: true };
    } catch (error) {
      console.error('[IPC:AgentHarness] saveOverride error:', error?.message);
      return { success: false, error: error?.message };
    }
  });

  console.log('[IPC:AgentHarness] Handlers registered');
}

module.exports = { setupAgentHarnessHandlers };
