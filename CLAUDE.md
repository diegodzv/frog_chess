# Frog Chess — contexto del proyecto

## Qué es esto

Torneo de ajedrez de una oficina, jugado a través de chess.com entre compañeros de trabajo (16-40 personas), repartido a lo largo de varios meses. Formato "estilo Pokémon VGC": primero una fase de rondas suizas, luego una fase eliminatoria (single elimination) con los mejores clasificados. "Frog" viene de la mascota de la empresa del usuario, no tiene relación funcional con el proyecto.

La app debe: gestionar el registro de jugadores, generar los emparejamientos de cada ronda, detectar automáticamente los resultados de las partidas jugadas en chess.com, y mostrar un ranking/bracket que se actualiza solo.

## Decisiones de diseño clave (no renegociar sin motivo)

- **Hosting**: GitHub Pages del usuario (repo personal, público — el plan gratuito de Pages para cuentas personales no permite repos privados).
- **chess.com PubAPI** (`api.chess.com/pub`): de solo lectura, sin OAuth/autenticación, **sin CORS**. No se puede llamar desde el navegador — solo desde Node (GitHub Actions o scripts locales). No existe forma oficial de "vincular"/verificar que alguien es dueño de un username; cada jugador simplemente lo declara.
- **Cero backend propio, cero servicios de pago**: todo dentro de GitHub. Pages sirve estáticos, JSON versionado en `data/` hace de "base de datos", GitHub Actions hace de "backend".
- **Backend en Node.js** (no Python) — el usuario lo confirmó explícitamente tras plantearse usar un venv de Python; se mantuvo Node por poder reutilizar `tournament-organizer` (swiss pairing con blossom matching + tiebreaks), que no tiene equivalente maduro en Python.
- **Registro de jugadores**: vía GitHub Issue Form (nombre + username chess.com). Una Action lo valida contra la API de chess.com y lo añade al roster.
- **Avance de rondas**: MANUAL, disparado por un organizador vía `workflow_dispatch`. Nunca automático por fecha.
- **Resultados**: automáticos vía API de chess.com, pero **nunca se adivina**: partidas ambiguas (varias candidatas, resultados inconsistentes) o partidas sin jugar se marcan para revisión manual del organizador, nunca se resuelven solas.
- **Cortafuegos corporativo bloquea chess.com** (categoría "gaming", confirmado por el usuario): no afecta a producción (los runners de GitHub Actions están fuera de la red de la oficina), pero sí a cualquier prueba/desarrollo local hecho desde un equipo de la oficina.

## Arquitectura

```
Issue Form (registro) ──▶ register-player.yml ──▶ data/players.json
                                                          │
organizador ──workflow_dispatch──▶ advance-round.yml ────┤──▶ data/engine-state.json (tournament-organizer)
                                                          │    data/tournament.json (fase, fechas de ronda)
cron horario ──▶ sync-results.yml (llama chess.com API) ─┘
                                                          │
                                          build-public-data.mjs
                                                          ▼
                                              data/public/*.json
                                                          │
                                          deploy-pages.yml (push a main)
                                                          ▼
                                    GitHub Pages: Vite+React (standings, ronda, bracket, registro)
```

Todos los workflows que escriben en `data/` comparten `concurrency: {group: tournament-data, cancel-in-progress: false}` para que el sync programado y el avance manual de ronda nunca corran en paralelo (se encolan).

Motor de torneo: [`tournament-organizer`](https://www.npmjs.com/package/tournament-organizer) (slashinfty, v4.1.1 fijada) — soporta nativamente swiss (`stageOne`) seguido de single-elimination (`stageTwo`) con corte configurable, y serializa su estado como JSON plano (`getValues()`/`loadTournament()`), que es justo lo que se persiste en `data/engine-state.json`.

## Estructura del repo

```
frog_chess/
├── .github/
│   ├── ISSUE_TEMPLATE/player-registration.yml   # formulario de inscripción
│   └── workflows/
│       ├── ci.yml                # tests + build en push/PR
│       ├── register-player.yml   # on: issues → valida y añade jugador
│       ├── sync-results.yml      # cron horario + workflow_dispatch
│       ├── advance-round.yml     # workflow_dispatch (organizador): start-tournament | next-round | force-next-round
│       └── deploy-pages.yml      # push a main → build + publica Pages
├── data/
│   ├── players.json              # roster
│   ├── tournament.json           # config del torneo + fase + ventanas de fecha por ronda
│   ├── engine-state.json         # dump de tournament-organizer (null hasta que empieza el torneo)
│   ├── overrides.json            # resultados/forfaits manuales del organizador
│   ├── needs-review.json         # partidas ambiguas detectadas por el matcher
│   └── public/                   # generado por build-public-data.mjs, consumido por el frontend
├── scripts/                      # Node ESM, ejecutado por las Actions (y localmente)
│   ├── lib/
│   │   ├── chesscomClient.mjs    # fetch a api.chess.com, backoff 429/5xx, memoización, trimming de campos
│   │   ├── tournamentEngine.mjs  # único punto de contacto con tournament-organizer
│   │   ├── resultMatcher.mjs     # empareja partidas de chess.com con pairings; nunca adivina en ambigüedad
│   │   ├── issueForm.mjs         # parsea el markdown autogenerado del Issue Form
│   │   ├── repoData.mjs          # leer/escribir data/*.json
│   │   └── commitAndPush.mjs     # git add+commit+push con reintento pull --rebase
│   ├── register-player.mjs
│   ├── sync-results.mjs
│   ├── advance-tournament.mjs
│   ├── build-public-data.mjs
│   ├── dev/
│   │   ├── spike-tournament-organizer.mjs   # ver "Qué falta" — pendiente de ejecutar
│   │   └── smoke-chesscom.mjs
│   ├── fixtures/                 # respuestas de ejemplo de chess.com para tests
│   └── __tests__/                # node:test — chesscomClient y resultMatcher no necesitan red
└── web/                           # Vite + React, multi-página estática (index/round/bracket/register.html)
    └── src/{pages,components,hooks}/...
```

## Esquemas de datos (resumen — ver los ficheros reales en `data/` para el detalle)

- `players.json`: `{ players: [{ id, name, chesscomUsername, chesscomPlayerId, status, registeredAt }] }`
- `tournament.json`: config (`timeClass`, `rules`, `requireRated`, `swissRounds`, `playoffCutoff`, `playerCap`) + estado (`phase`: registration|stage-one|stage-two|complete, `currentRound`, `rounds[]` con ventanas de fecha por ronda — esto es responsabilidad nuestra, la librería no modela fechas).
- `engine-state.json`: volcado literal de `tournament.getValues()`. No se edita a mano.
- `overrides.json`: cola de resultados/forfaits manuales (`outcome`: player1_win|player2_win|draw|double_forfeit), idempotente vía el flag `applied`.
- `needs-review.json`: partidas ambiguas/inconsistentes que el matcher no resuelve solo.
- `public/*.json`: derivados de solo lectura para el frontend (standings, current-round, bracket, players, meta).

## Estado actual: qué está hecho

Todo lo de abajo son **ficheros escritos pero nunca ejecutados ni instalados** — se generaron en una máquina sin `node`/`npm`/`git`. Nada se ha verificado todavía.

- [x] Estructura completa del repo (backend, workflows, frontend, datos semilla).
- [x] `chesscomClient.mjs` + `resultMatcher.mjs` + tests (`chesscomClient.test.mjs`, `resultMatcher.test.mjs`) — no dependen de red real, deberían pasar tal cual con `npm test`.
- [x] `tournamentEngine.mjs` (wrapper de `tournament-organizer`) + `tournamentEngine.test.mjs` — este test sí requiere que el paquete esté instalado y que sus asunciones sobre la API real sean correctas.
- [x] `register-player.mjs`, `sync-results.mjs`, `advance-tournament.mjs`, `build-public-data.mjs`.
- [x] Los 5 workflows de GitHub Actions + la plantilla de Issue Form.
- [x] Se detectó y corrigió una vulnerabilidad de inyección de código en `register-player.yml`: el nombre introducido por el usuario en el issue se interpolaba directamente en un script de `actions/github-script`; ahora se pasa por variables de entorno.
- [x] Frontend Vite+React (4 páginas estáticas: standings, ronda, bracket, registro) con estilos y modo oscuro/claro automático.
- [x] `README.md` con el runbook de arranque.

## Qué falta por hacer

Por orden recomendado, ahora que el desarrollo se traslada a una máquina con `node`/`npm`/`git`:

1. **Verificación básica**: `cd scripts && npm install && npm test`. Los tests de `chesscomClient`/`resultMatcher` deberían pasar sin más. Si `tournamentEngine.test.mjs` falla, es señal de que alguna asunción sobre la API real de `tournament-organizer` está mal y hay que ajustar `lib/tournamentEngine.mjs`.
2. **Spike obligatorio antes de fiarse del motor en producción**: `npm run spike` (dentro de `scripts/`) — ejecuta `dev/spike-tournament-organizer.mjs`, que crea un torneo suizo sintético de 9 jugadores (impar, para forzar un bye) y confirma explícitamente **cómo se dispara la transición swiss→eliminación** (la documentación pública de la librería no lo detalla) y cómo se gestionan los byes. Ajustar `advanceRound`/`buildBracket` si el comportamiento observado difiere de lo asumido.
3. **Crear el repo en GitHub** y subir el código (ver instrucciones que se le dieron al usuario en el chat — resumen: `git init`, commit, crear repo vacío en GitHub, `git remote add origin`, push).
4. Configurar en GitHub: *Settings → Pages → Source = GitHub Actions*, y *Settings → Actions → General → Workflow permissions = Read and write permissions*.
5. Rellenar `web/src/config.js` con la URL real del repo (`REPO_URL`).
6. `cd web && npm install && npm run dev` para verificar el frontend localmente contra los datos semilla.
7. Pipeline de registro (Fase 3 del plan original): probar con issues reales (username válido, inválido, duplicado, registro cerrado) una vez el workflow esté corriendo en GitHub.
8. Motor suizo end-to-end (Fase 4): llevar un roster de prueba (ideal: impar, para forzar un bye) por todas las rondas hasta playoffs disparando `advance-round.yml` manualmente; disparar dos avances seguidos para confirmar que el `concurrency group` los serializa.
9. Sync automático con chess.com real (Fase 5): probar con cuentas reales jugando partidas rapid — detección normal, caso ambiguo (dos partidas el mismo día) correctamente marcado y no adivinado, partida fuera de ventana no se forfeitea sola.
10. Pulido de frontend + simulacro completo end-to-end (Fase 6) con un torneo pequeño (8-16 jugadores) antes del torneo real de oficina.
11. (Extra, opcional) Issue Form para overrides de resultado, proceso de cambio de username, aviso automático cuando algo cae en `needs-review.json`.

## Riesgos y limitaciones conocidas (ya documentados en el diseño, no son bugs pendientes de arreglar sino trade-offs aceptados)

- Rate limiting de chess.com sin límite publicado — mitigado con backoff, caché por ejecución y cron no agresivo (horario).
- Ambigüedad de partidas múltiples / resultados inconsistentes → siempre a revisión manual, nunca se adivina.
- Partida no jugada en la ventana de ronda → nunca se forfeitea sola; requiere `overrides.json` + `force-next-round`.
- Cambio de username de chess.com a mitad de torneo → no hay lookup inverso en la API pública; proceso manual.
- Número impar de jugadores → delegado al manejo de byes de `tournament-organizer` (pendiente de confirmar en el spike, punto 2 de arriba).
- El bot de Actions necesita permisos de escritura activados manualmente una vez en la configuración del repo.
- Repo público → nombres reales + usernames de chess.com visibles; el Issue Form pide consentimiento explícito y nunca se guarda email ni otros datos sensibles.
- `tournament-organizer` es una librería pequeña de un solo mantenedor; toda la interacción con ella está aislada en `lib/tournamentEngine.mjs` para poder cambiarla sin tocar el resto del código si hiciera falta.
