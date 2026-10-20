// Last-run bookkeeping for the health dashboard (per server instance).
const runs = new Map();

export const recordRun = (name, outcome) => runs.set(name, { ...outcome, at: new Date().toISOString() });

export const workerStatus = () => ({
  tasks: Object.fromEntries(runs),
});
