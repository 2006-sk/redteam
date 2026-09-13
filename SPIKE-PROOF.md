# Wasmer SDK 0.13.0 — EMPIRICALLY VERIFIED on this machine, 2026-09-13 ~11:05 PDT
# (macOS, Node 26, @wasmer/sdk@0.13.0, python/python@=3.13.20)

## Timings
- COLD first sandbox (downloads runtime): 13,331 ms   <- the 50-70MB download, ONCE
- Cache written to ./.wasmer : 66 MB  (matches documented 50-70MB/runtime)
- WARM sandbox create (after priming): 0.1 ms  <- Wasmer's 0.140ms benchmark is REAL
- WARM exec (python -c 'print(1)'): ~160 ms

## Containment — ALL HOLD (this is your demo)
| Attack (agent-generated code)        | Result                                    |
|--------------------------------------|-------------------------------------------|
| print() normal                        | exit 0, stdout returned                    |
| open('/etc/passwd').read()            | FileNotFoundError [Errno 44] — FILE NOT IN SANDBOX FS |
| socket.create_connection(1.1.1.1:80)  | OSError [Errno 58] Not supported — NO SOCKET |
| while True: pass  (timeoutMs=1500)    | reason="timeout", killed after 1578ms      |

## What this proves for the pitch
1. "Air-gapped by default": network omitted => guest CANNOT open a socket. Verified.
2. "No host filesystem": /etc/passwd doesn't even EXIST in the guest. Verified.
   (There is literally no mount API in 0.13.0 to expose a host path.)
3. "Runaway code is killed": timeoutMs fires on infinite loop. Verified.
4. "Instant to detonate": 0.1ms warm create => you can spin one sandbox PER PAYLOAD live on stage.

## The ONE caveat to say out loud (a judge will find it otherwise)
No memory/CPU/fuel cap in 0.13.0 — only timeoutMs + outputBytes.
Mitigation to state: one sandbox per worker, killable; timeout bounds wall-clock.

## WARM THE CACHE before demo: run any sandbox once on the DEMO laptop, DEMO browser,
## DEMO origin. Browser cache is origin-scoped. Cold = 13s of dead air on stage.
