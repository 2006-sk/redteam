// ── Base agent ──────────────────────────────────────────────────────────
// Wraps a persona in the common lifecycle: boot its own Tenki VM, give it a
// context to attack THROUGH that VM, read/write shared memory, emit events,
// then tear the VM down. The persona supplies the actual attack logic.
//
// The loop the master doc describes:
//   read shared memory → decide → attack (on the VM) → observe → write → emit
//
// With an LLM brain (brain.mjs) the "decide" step is an LLM planning call; the
// oracle (judge.mjs) confirms weaknesses. Without a key, it runs the persona's
// deterministic script. Either way the Tenki VM does the executing.
import { brainAvailable, brainProvider, modelFor, planNextAction } from "../brain.mjs";
import { judge } from "../judge.mjs";

const MAX_BRAIN_STEPS = Number(process.env.BRAIN_STEPS || 5);

export class Agent {
  constructor({ persona, driver, coord }) {
    this.persona = persona;          // { name, agentId, run(ctx) }
    this.driver = driver;            // Tenki driver (mock or real)
    this.coord = coord;              // CoordClient
    this.vm = null;
  }

  async run() {
    const { persona, driver, coord } = this;
    // 1. boot this agent's own disposable Tenki VM
    this.vm = await driver.createVM(persona.agentId);
    await coord.emit({
      event_type: "attack_started", agent_id: persona.agentId, agent_persona: persona.name,
      target_component: "(boot)", severity: "info",
      description: `${persona.agentId} online — VM ${this.vm.id} (${driver.mode})`,
    });

    // 2. context the persona attacks through
    const ctx = {
      agentId: persona.agentId,
      personaName: persona.name,
      // issue an attack FROM the VM
      attack: (req) => driver.runAttack(this.vm, req),
      // announce an attempt (drives the jet animation)
      started: (component, description) => coord.emit({
        event_type: "attack_started", agent_id: persona.agentId, agent_persona: persona.name,
        target_component: component, severity: "info", description,
      }),
      // report a confirmed weakness (hurts the tower)
      weakness: (component, severity, description) => coord.emit({
        event_type: "weakness_found", agent_id: persona.agentId, agent_persona: persona.name,
        target_component: component, severity, description,
      }),
      // report a miss (jet peels off, no damage)
      miss: (component, description) => coord.emit({
        event_type: "attack_result", agent_id: persona.agentId, agent_persona: persona.name,
        target_component: component, severity: "low", description,
      }),
      // shared memory
      remember: (rec) => coord.remember({ agent_id: persona.agentId, ...rec }),
      briefing: (q) => coord.briefing(q),
      log: (...a) => console.log(`[${persona.agentId}/${persona.name}]`, ...a),
    };

    // 3. run the attack logic
    try {
      // The LLM brain drives autonomous discovery (novel payloads, adapting to
      // responses, using shared memory).
      if (brainAvailable()) {
        await this._runBrainLoop(ctx);
      }
      // The deterministic pass ALWAYS runs as a coverage backstop: some checks
      // — e.g. the dos burst that proves a missing rate limit — a single LLM
      // request can't express. With a brain it's the safety net under
      // autonomous discovery; without a key it IS the swarm.
      await persona.run(ctx);
    } catch (e) {
      await coord.emit({
        event_type: "attack_result", agent_id: persona.agentId, agent_persona: persona.name,
        target_component: "(error)", severity: "low", description: `agent error: ${String(e)}`,
      });
    } finally {
      // 4. tear the VM down (ephemeral, always)
      await driver.destroyVM(this.vm);
      await coord.emit({
        event_type: "attack_result", agent_id: persona.agentId, agent_persona: persona.name,
        target_component: "(teardown)", severity: "info", description: `${persona.agentId} VM destroyed`,
      });
    }
  }

  // The autonomous loop: LLM plans → VM executes → oracle judges → memory/emit.
  async _runBrainLoop(ctx) {
    const persona = this.persona.name;
    const model = modelFor(persona);
    const history = [];
    let confirmed = 0;
    for (let step = 0; step < MAX_BRAIN_STEPS; step++) {
      const briefing = (await ctx.briefing()).briefing || {};
      const action = await planNextAction({ persona, briefing, history, targetHint: process.env.TARGET_BASE_URL || "an HTTP web app" });
      if (!action) break;                 // planning failed → let deterministic pass run
      if (action.stop) break;
      ctx.log(`🧠 ${model.split("/").pop()} → ${action.method} ${action.path} — ${action.rationale}`);
      await ctx.started(action.path, `🧠 ${action.rationale}`);
      const res = await ctx.attack({ method: action.method, path: action.path, headers: action.headers, body: action.body });
      const verdict = judge(persona, action, res);
      if (verdict.weakness) {
        confirmed++;
        await ctx.weakness(action.path, verdict.severity, verdict.description);
        await ctx.remember({ action_taken: `${action.method} ${action.path}`, target_component: action.path, outcome: "success", notes: `[${model.split("/").pop()}] ${verdict.description}` });
      } else {
        await ctx.miss(action.path, `🧠 ${action.rationale} → no weakness (status ${res.status})`);
        await ctx.remember({ action_taken: `${action.method} ${action.path}`, target_component: action.path, outcome: "miss", notes: action.rationale });
      }
      history.push({ path: action.path, method: action.method, status: res.status, weakness: verdict.weakness });
    }
    return confirmed;
  }
}
