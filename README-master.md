# Tower Siege — Autonomous Red-Team Swarm

**Event:** AI Security Hackathon (Wasmer + Tenki Cloud) · Sunday, Sept 13, 2026 · EF, 501 Folsom St, SF
**Build window:** 10:00 AM – 6:00 PM · **Demos & judging:** 6:00–7:30 PM
**Team:** Kenil (frontend) · Shresth (agents + Tenki + Wasmer integration) · Pranay (Wasmer / target)

> Working name — swap it for whatever you land on, but keep it consistent across all four docs and the demo video once you do.

## One-line pitch
Five autonomous red-team agents, each running in its own Tenki Cloud VM, attack a real target app sandboxed inside Wasmer — live, with shared attack memory so they build on each other's findings. The frontend renders it as a tower under siege: agents as jets swarming in, the tower taking visible damage, a live banner and graph showing exactly what broke and how.

---

## Why this fits the actual judging criteria
Per the event page, judges score: **working demo on a real, authorized target · technical depth · originality · shock factor · progress made on the day.** Sponsor tracks add **how effectively the project uses the sponsor's product.**

- **Real, authorized target — non-negotiable.** The target must be something your team has explicit rights to attack: an app you built yourselves for this purpose, or a known intentionally-vulnerable sample app. Never point this at a real third-party production system, even "just for the demo." This isn't optional polish — it's literally in the rubric, and almost certainly a disqualifying issue if violated.
- **Shock factor + originality** → the tower/swarm visualization is your answer to this. It's the single highest-leverage thing to get right, because it's what's on screen for your 3-minute video.
- **Wasmer track** → the target must genuinely run inside a Wasmer SDK sandbox, not be imported once and ignored.
- **Tenki track** → the 5 agents must genuinely run on Tenki Sandbox VMs (disposable, per-second-billed Linux VMs with root access), not just reference the SDK.

## Sponsor prizes on the table
- Cash: 🥇 $1,000 · 🥈 $500 · 🥉 $250
- Wasmer track: 🥇 $5,000 · 🥈 $2,500 · 🥉 $1,500 in Wasmer credits
- Tenki Cloud: $10,000 in credits for the winner

---

## Architecture

```
┌─────────────┐     attack attempts      ┌──────────────────────────┐
│  5 Agents   │ ────────────────────────▶│   Target ("the Tower")   │
│ (1 per Tenki│                           │   running inside a       │
│  Sandbox VM)│◀──────────────────────────│   Wasmer SDK sandbox     │
└──────┬──────┘   health / crash signals  └──────────────────────────┘
       │
       │ read/write            ┌───────────────────────┐
       ├───────────────────────▶  Shared attack memory  │
       │                       └───────────────────────┘
       │
       │ POST events
       ▼
┌─────────────────────┐   WebSocket broadcast   ┌────────────────────────┐
│     Coordinator      │────────────────────────▶│   Frontend: the Tower   │
│ (owned by Shresth)   │                         │   under siege (Kenil)   │
└─────────────────────┘                         └────────────────────────┘
```

**Pranay** owns the box on the right (target + Wasmer sandbox + instrumentation).
**Shresth** owns the box on the left (5 agents, their Tenki VMs, shared memory, and the Coordinator that ties everything together).
**Kenil** owns the box at the bottom right (everything the audience actually looks at).

---

## The event contract — lock this first, before anyone writes attack or animation code

Every event flowing through the Coordinator uses this shape. All three of you build against it, so agree on any changes as a group, not unilaterally.

```json
{
  "event_type": "attack_started | attack_result | weakness_found | target_health",
  "agent_id": "agent-1",
  "agent_persona": "recon | injection | auth_bypass | dos | logic_abuse",
  "target_component": "string — which endpoint/module was hit",
  "severity": "info | low | medium | high | critical",
  "description": "human-readable one-liner for the banner",
  "health_delta": -5,
  "timestamp": "ISO 8601"
}
```

- `attack_started` / `attack_result` — drives the jet animations (jet flies toward tower, then peels off or "hits").
- `weakness_found` — drives the banner + graph. `severity: critical` should visibly hurt the tower.
- `target_health` — periodic heartbeat from Pranay's instrumentation, even with nothing attacking, so the frontend always has a live number.

If you need a field this doesn't cover, add it — just add it here first and tell the other two before you rely on it.

---

## Suggested build timeline (8-hour window)

| Time | Milestone |
|---|---|
| 10:00–10:30 | Confirm target app choice, event schema, and each person's SDK access (Wasmer + Tenki accounts/keys) before writing real code |
| 10:30–12:30 | Each person builds their core piece in isolation against a **mocked** version of the other two interfaces |
| 12:30–1:00 | First real integration checkpoint: can an agent event actually reach the frontend end to end, even with fake data? |
| 1:00–3:30 | Real logic: real attacks, real Wasmer target, real animations |
| 3:30–4:30 | Full integration pass — real agents hitting the real target, real events driving the real frontend |
| 4:30–5:30 | Polish pass on the demo path specifically — what the 3-minute video will show, nothing else |
| 5:30–6:00 | Record the video, write the free-text submission, push the repo public |

## Submission checklist (BuilderBase)
- [ ] 3-minute max demo video
- [ ] GitHub repo public/open source, linked in submission
- [ ] Free-text field: inspiration, what you built, what each sponsor tool does in your architecture
- [ ] Confirm the target used in the video is one you built/own — say so explicitly in the free-text field, it preempts the "authorized target" judging question

## Individual docs
- `README-pranay-wasmer.md` — target app + Wasmer sandbox + instrumentation
- `README-shresth-agents.md` — 5 agents + Tenki VMs + shared memory + Coordinator
- `README-kenil-frontend.md` — the tower/swarm visualization, banner, graph
