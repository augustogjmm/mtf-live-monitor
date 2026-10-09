'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const exportsByEngine = {
  'mtf-alert-watcher': ['authorizedEngineRequest'],
  'mtf-crypto-engine': ['emptyState','step','ladderFromState','publicLevel','context',
    'directionEligibility','qualifiedOb','rejectsZone','tradePlan','levelFromPublic',
    'confirmationSafety','confirmationSnapshot','authorizedEngineRequest'],
  'mtf-adr-engine': ['diagnostic','confirmationPlan','selftest','forwardConfirmation','weeksFromDaily','authorizedEngineRequest'],
  'mtf-daily-backfill': ['regulatedLiveDiagnostic','regulatedRiskProfile','confirmedCedearRecovery','ladderSignal','MIN_RR','authorizedEngineRequest']
};
function loadEngine(name, options={}) {
  const names = exportsByEngine[name];
  if (!names) throw Error('Unsupported engine');
  const file = path.join(__dirname, '../../supabase/functions', name, 'index.ts');
  const source = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), {mode:'transform'})
    .replace(/^import .*;\s*$/mg, '');
  let handler;
  class Clock extends Date {
    constructor(...args) { super(...(args.length?args:[options.now??Date.now()])); }
    static now() { return options.now??Date.now(); }
  }
  const deny = () => { throw Error('External effects are disabled in strategy validation'); };
  const context = {
    Date:Clock, console, URL, Request, Response, AbortController, AbortSignal, atob,
    setTimeout, clearTimeout, fetch:options.fetch??deny,
    createClient:()=>({from:deny,rpc:deny}),
    Deno:{env:{get:name=>options.variables?.[name]},serve:fn=>{handler=fn}}
  };
  const script = new vm.Script(source + '\nglobalThis.rules={' + names.join(',') + '};', {filename:file});
  const sandbox = vm.createContext(context);
  script.runInContext(sandbox, {timeout:5000});
  return {rules:sandbox.rules, handler};
}
module.exports = {loadEngine};
