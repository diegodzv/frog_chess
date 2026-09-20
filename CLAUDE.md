# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es esto

Torneo de ajedrez de una oficina (20-60 personas), jugado en chess.com a lo largo de varios meses. Formato "estilo Pokémon VGC": rondas suizas y después eliminatoria (single elimination) con los mejores clasificados. Cada emparejamiento es una **serie de partidas**: al mejor de 3 (Bo3) en todas las rondas salvo semifinales y final, que son al mejor de 5 (Bo5). **Las tablas no cuentan: se juega otra partida; gana la serie quien primero llegue a 2 victorias (Bo3) o 3 (Bo5), así que nunca hay encuentros empatados.** "Frog" es la mascota de la empresa del usuario, sin relación funcional. La app registra jugadores, genera emparejamientos, (debe) detectar resultados en chess.com y publica ranking/bracket. Documentación, mensajes de error de cara al organizador y mensajes de commit en español; identificadores y comentarios de código en inglés.

## Comandos

Dos paquetes npm independientes, sin lint ni formateador configurados. Node 20 (`.nvmrc`; el local es 24 y también vale).

```bash
# Backend / scripts (scripts/)
cd scripts && npm install
npm test                                              # node --test: descubre solo los *.test.mjs (no le pases directorios: falla en Node >=22)
node --test __tests__/series.test.mjs                 # un solo fichero
node --test --test-name-pattern="Bo5" __tests__/series.test.mjs   # un solo test
npm run spike                                         # comprueba el comportamiento de tournament-organizer (sin red)
npm run smoke:chesscom                                # llama a la API real de chess.com (necesita red sin filtro)
node build-public-data.mjs                            # regenera data/public/*.json; puro, sin red ni git
npm run reset -- --yes [--keep-players]               # vuelve a fase de inscripción (para pasar de pruebas al torneo real); no commitea

# Simulación (fake players + partidas simuladas; NO toca data/)
node dev/simulate-tournament.mjs                      # 20, 40 y 60 jugadores -> sim/n20, sim/n40, sim/n60 (+ 2 snapshots a medias) y estadísticas
node dev/simulate-tournament.mjs --players=32 --seed=7 --runs=500 --no-show=0.05
node dev/simulate-tournament.mjs --swiss-rounds=7 --cutoff=8 --out=/tmp/sim   # probar otro formato sin pisar sim/

# Frontend (web/)
cd web && npm install
npm run dev        # predev copia data/public -> web/public/data y sim/*/public -> web/public/data/sim/* (gitignored)
npm run build      # salida en web/dist
# Ver una simulación: http://localhost:5173/index.html?data=sim/n40  (hay un selector "Datos:" en la barra si existe sim/)
```

`tournamentEngine*.test`, `tournamentFlow*.test`, `simulation.test`, `buildPublicData.test`, `resetTournament.test` y `registerPlayer.test` usan el paquete real `tournament-organizer` (no mockeado). `registerPlayer.test` ejecuta `register-player.mjs` como proceso, con el cuerpo de issue de GitHub y chess.com simulado (`__tests__/helpers/stub-chesscom.mjs`, cargado con `--import`). Ningún test usa red real. Con Node 20 (CI) y Node 24 pasan los 78+ tests.

Guía de uso para el organizador (puesta en marcha, inscripción, rondas, overrides): `docs/ORGANIZADOR.md`.

## Gotchas

- **Los scripts que escriben datos hacen `git add data && git commit && git push` de verdad** (`register-player`, `sync-results`, `advance-tournament` vía `lib/commitAndPush.mjs`). Para ejecutarlos en local sin efectos: `FROG_SKIP_GIT=1` (no commitea) y `FROG_DATA_DIR=<dir>` (lee y escribe otra copia de `data/`; `lib/repoData.mjs`). El simulador y las pruebas de E/S usan ambos.
- **Series Bo3/Bo5 y `sync-results`**: `resultMatcher.findGameForPairing` sigue asumiendo UNA partida por emparejamiento (varias = "ambiguo"). Por eso `sync-results.mjs` se niega a resolver nada automáticamente cuando la ronda es Bo>1 (solo loguea). **La detección automática de series en chess.com está pendiente**: hay que agregar las partidas entre los dos jugadores dentro de la ventana, en orden cronológico, con `scoreSeries(games, bestOf)` (`lib/series.mjs`; las tablas se ignoran y las partidas posteriores a la decisión también), dejar la serie pendiente mientras esté `in_progress`, decidir qué hacer ante partidas anómalas, y reescribir los tests del matcher. Mientras tanto, `sync-results` ya trata una única partida en tablas como "falta otra partida" en vez de resolver. Hasta entonces los resultados se meten a mano (`overrides.json` + `force-next-round`).
- **Los `package-lock.json` de `scripts/` y `web/` deben estar commiteados**: todos los workflows hacen `npm ci` con `cache-dependency-path: */package-lock.json` y fallan sin ellos.
- **Redespliegue tras los commits del bot**: los push hechos con el `GITHUB_TOKEN` no disparan `deploy-pages.yml`, así que `register-player`, `sync-results` y `advance-round` terminan con un paso que ejecuta `gh workflow run deploy-pages.yml` solo si su `HEAD` cambió (necesitan `permissions: actions: write`). **Escrito pero sin probar en GitHub**: comprobar en el primer registro real que aparece un run de "Deploy Pages" tras el del bot.
- El repo tiene `core.autocrlf=true`: los ficheros originales están en CRLF y los añadidos después en LF. No lo "arregles" en masa; si editas con scripts, tenlo en cuenta al hacer reemplazos de texto.
- El repo es `github.com/diegodzv/frog_chess` (Pages en `diegodzv.github.io/frog_chess/`); `REPO_URL` y el `USER_AGENT` de chess.com ya lo usan. `battle_subway_helper/` (otro proyecto del usuario copiado dentro del directorio, con su propio repo/Pages) está en `.gitignore`: no mezclarlo.
- Cortafuegos de la oficina bloquea chess.com: `smoke:chesscom` y cualquier prueba con red real hay que hacerlas desde otra red. Los runners de Actions no se ven afectados.

## Decisiones de diseño (no renegociar sin motivo)

- **Cero backend propio y cero servicios de pago**: GitHub Pages sirve estáticos, JSON versionado en `data/` es la "base de datos", GitHub Actions es el "backend". Repo público (Pages gratis en cuenta personal no admite privados): nombres reales y usernames quedan visibles.
- **chess.com PubAPI** (`api.chess.com/pub`): solo lectura, sin auth, **sin CORS** -> solo se llama desde Node, nunca desde el navegador. No hay forma oficial de verificar que alguien es dueño de un username; cada jugador lo declara.
- **Node.js, no Python** (confirmado explícitamente por el usuario), para reutilizar `tournament-organizer` (swiss con blossom matching + tiebreaks), sin equivalente maduro en Python.
- **Registro**: GitHub Issue Form (nombre + username) -> Action lo valida contra chess.com y lo añade a `data/players.json` (guarda `issueNumber`; editar un issue ya aceptado es un no-op, cambiar su usuario se rechaza; si chess.com falla o bloquea, el jugador recibe un mensaje de reintento; la duplicidad se comprueba también contra el nombre canónico de chess.com). El workflow se activa por la etiqueta `registration` **o** por el prefijo `[Inscripción]` del título, porque el formulario solo añade etiquetas que ya existan en el repo. El contenido del issue es input no confiable: en `register-player.yml` se pasa por `env`, nunca interpolado en el script de `github-script` (ya hubo una inyección corregida).
- **Avance de ronda MANUAL** (`workflow_dispatch` de `advance-round.yml`: `start-tournament | next-round | force-next-round`). Nunca automático por fecha.
- **Resultados nunca adivinados**: partida ambigua o inconsistente -> `needs-review.json`; partida sin jugar -> pendiente. Una partida no jugada jamás se forfeitea sola: requiere entrada manual en `overrides.json` + `force-next-round`.
- **Formato (valores por defecto elegidos en la simulación, ajustables en `data/tournament.json`)**:
  - Rondas suizas = `ceil(log2(n))` (`"swissRounds": "auto"`): 20->5, 40->6, 60->6. Corte a eliminatorias = mayor potencia de 2 <= n/2 acotada a [4,16] (`"value": "auto"`): 20->8, 40->16, 60->16. Un número explícito manda sobre `auto`; el corte tiene que ser potencia de 2. Se resuelven al iniciar el torneo y se guardan como números en `tournament.json`.
  - Series (`"series"`): `swiss: 3`, `elimination: 3`, `semifinal: 5`, `final: 5`. Sin partido por el 3.er puesto.
  - Reglas de serie (`lib/series.mjs`, definidas por el usuario): la serie termina cuando alguien llega a `ceil(bestOf/2)` victorias; una partida en tablas no puntúa y se repite, por lo que un "Bo3" puede durar más de 3 partidas. No existen encuentros empatados ni desempate a muerte súbita: `applySeriesResult` rechaza cualquier marcador que no sea `need`-N con N < need.
  - **Comparado con Play! Pokémon (VGC)** (Tournament Rules Handbook §5.5.1, §5.6.1, §5.5.4.1; investigado y simulado): las rondas suizas coinciden con su tabla (9-16 -> 4, 17-32 -> 5, 33-64 -> 6 = `ceil(log2 n)`). El bye que usa la librería ya es el de Pokémon —ronda 1 al azar; después al peor récord sin bye previo, aleatorio dentro de ese grupo, nunca dos veces; medido en 1500 torneos de 29 jugadores: 100 % de las veces al peor récord, sin sesgo por orden de inscripción— y `verifyTournament` lo comprueba como invariante. Su desempate ("resistencia": win % de los rivales con mínimo 25 % y sin contar byes, luego win % de los rivales de los rivales) NO mejora el nuestro (Buchholz mediano, Sonneborn-Berger, dif. de partidas): en 1500 torneos por variante las diferencias están dentro del ruido (p. ej. gana el mejor 62,1 % vs 62,9 %); alternativa equivalente y aprox. sin código: `"tiebreaks": ["opponent match win percentage", "opponent opponent match win percentage", "game win differential"]` en `tournament.json`. Su corte es top 8 para 17-64 jugadores (nosotros 8/16/16 según n); top 8 vs 16 en 40-60 jugadores gana el mejor 55 % vs 56-58 % y ahorra una ronda: decisión abierta del usuario.
  - Puntos: serie ganada 1, perdida 0, bye 1 (sin medios puntos). Desempates: Buchholz mediano -> Sonneborn-Berger -> diferencia de partidas. Consecuencia medida en simulación: con puntos enteros, en el 100 % de los torneos el corte a eliminatorias lo decide el desempate (10-16 jugadores empatados a los puntos de la línea) y más rondas suizas (7 u 8) no lo arreglan ni mejoran quién gana; es inherente a suizo + corte.

## Arquitectura

```
Issue Form ──▶ register-player.yml ──▶ data/players.json
organizador ─▶ advance-round.yml ─────▶ data/engine-state.json + data/tournament.json   (lib/tournamentFlow.mjs)
cron horario ▶ sync-results.yml ──────▶ (chess.com; hoy solo resuelve rondas Bo1, ver Gotchas)
                         └─ todos terminan en build-public-data.mjs ─▶ data/public/*.json
push a main (data/public/** o web/**) ─▶ deploy-pages.yml ─▶ web/ (Vite+React) en GitHub Pages
```

Los tres workflows que escriben en `data/` comparten `concurrency: {group: tournament-data, cancel-in-progress: false}`: se encolan.

Cosas que exigen leer varios ficheros para entenderlas:

- **`lib/tournamentEngine.mjs` es el único punto de contacto con `tournament-organizer`** (v4.1.1 fijada). Su cabecera documenta lo verificado leyendo el código de la librería y con `npm run spike`: `Manager` es el export *default*; `nextRound()` solo existe en stage one y tras la última ronda suiza construye TODO el bracket de golpe (rondas numeradas a continuación de las suizas); en stage two los cruces avanzan solos con `enterResult()`, `tournament.round` no se mueve y el estado nunca pasa a `complete` salvo que se llame a `endTournament()`; `scoring.bestOf` es global y mutable y `enterResult` valida contra él (máx. victorias = `round(bestOf/2)`), así que `applySeriesResult` lo fija por partido antes de registrar; `assignLoss()` no sirve para el doble forfeit (lanza al segunda llamada), por eso `applyDoubleForfeit` escribe la derrota directamente; el `Swiss` de `tournament-pairings` baraja con `Math.random` en cada ronda (los sorteos no son reproducibles; el simulador siembra `Math.random`). Cada script rehidrata desde `data/engine-state.json` y guarda con `saveEngineTournament` (claves ordenadas -> diffs estables). `engine-state.json` no se edita a mano (es `null` hasta `start-tournament`).
- **`lib/tournamentFlow.mjs`** (`startTournament`, `advance`) es el ciclo de vida como transiciones puras, sin E/S: lo usan `advance-tournament.mjs` y el simulador (la misma ruta que producción). `advance` no muta lo que recibe y lanza sin dejar nada a medias (el script original marcaba overrides como aplicados aunque luego abortara).
- **Dos estados en paralelo**: la librería lleva emparejamientos y puntos; `data/tournament.json` lleva lo que no modela — `phase` (registration -> stage-one -> stage-two -> complete), `currentRound` y `rounds[]` (`number, phase, label, bestOf, startedAt, endedAt`). En stage two `currentRound` es nuestro: la librería activa un cruce en cuanto acaban sus dos feeders, pero la ronda solo "se abre" (y solo se sincroniza) cuando el organizador avanza; por eso `getUnresolvedMatches(engine, round)` filtra por ronda y la web muestra esos cruces como "Por jugar", no "Pendiente". Tras la final, `advance` llama a `finishTournament`.
- **La ventana de ronda gobierna la detección de resultados**: `resultMatcher.findGameForPairing` consulta los archivos mensuales de chess.com del jugador A y filtra por `timeClass`, `rules`, `requireRated`, los dos usernames y `endTime` dentro de la ventana (ver Gotchas: aún una partida por emparejamiento). `sync-results` sobrescribe `needs-review.json` entero en cada ejecución.
- **Identidad de jugador**: `players.json[].id` es el id del jugador en el motor y `chesscomUsername` se copia a su `meta` dentro de `engine-state.json` (de ahí lo lee `sync-results`). Un jugador registrado después de `start-tournament` no entra en el motor. El desempate final de la librería hace `parseInt(id, 36)`: con ids `p_nombre-hash` es constante (orden de inscripción), inocuo pero no significativo.
- **Overrides** (`data/overrides.json`, resultados manuales del organizador): cada entrada nombra el emparejamiento por `matchId` + `outcome`, o —lo cómodo— por usuarios de chess.com: `{"winner","loser"}` (serie ganada 2-0 en Bo3 / 3-0 en Bo5, sirve para walkovers) o `{"players":[a,b],"outcome":"double_forfeit"}`. Se aplican solo a partidas sin resolver de la ronda actual y solo una vez (`applied: true`); las que no coinciden con nada se devuelven en `skipped` y el workflow avisa. Tres acciones los usan: `apply-overrides` (aplica sin avanzar; la web muestra los resultados durante la ronda), `force-next-round` (aplica y avanza; aborta listando las pendientes sin cambiar nada) y `next-round` (avanza solo si no queda ninguna). `draw` no existe como resultado y `double_forfeit` solo vale en suizo (ambos pierden, 0 puntos, derrota en el récord). `rebuild-public-data` regenera `data/public/` tras editar `players.json` a mano.
- **`build-public-data.mjs`**: `derivePublicData` es pura (`{tournament, roster, engineState, now}` -> `meta, standings, rounds, bracket, players`); `buildPublicData` solo hace E/S y conserva el `updatedAt` anterior si el contenido no cambió (si no, el cron horario generaría un commit y un redeploy cada hora). Los puntos y desempates salen de `getSwissStandings` de la librería, no se recalculan; las victorias por serie/partida se cuentan a partir de los `matches`. Ojo: `player.value` de la librería es la siembra (siempre 0 aquí), no los puntos.
- **Frontend** (Vite multi-página: `index/round/bracket/register.html`, `base: './'`): pide los JSON en runtime con `useJson` (`cache: 'no-store'`); `src/dataset.js` resuelve `?data=sim/<n>` para ver simulaciones. `round.html` navega todas las rondas (`?round=N`), `bracket.html` pinta cada ronda con su Bo y marcadores. `web/public/data/` es una copia derivada (`web/copy-data.mjs`); `sim/` está en `.gitignore`, así que las simulaciones nunca llegan al despliegue.
- **Simulación** (`lib/simulation.mjs`): jugadores con Elo oculto, partidas con expectativa Elo y tablas más raras cuanto mayor la diferencia, no-shows (overrides vía `force`), `stopAt` para snapshots a mitad de ronda. `verifyTournament` comprueba invariantes (todos juegan una vez por ronda, sin repetir rival, byes, siembra 1 vs N, Bo3/Bo5 correctos, un campeón) y calcula métricas del formato; sus propios tests lo manipulan para comprobar que falla cuando debe.

## Estado y trabajo pendiente

Verificado en local (Node 20 y 24): todos los tests, spike, build del frontend, simulaciones de 20/40/60 jugadores (y impares, con no-shows y dobles forfeits) sin incidencias, el registro como proceso con chess.com simulado, y `advance-tournament.mjs` de extremo a extremo sobre una copia de `data/`. **No verificado**: nada de GitHub (workflows, Issue Form, Pages, el redespliegue del bot) ni nada contra chess.com real (incluida la posibilidad de que bloquee las IPs de los runners de Actions).

1. **Detección de series en chess.com** (ver Gotchas): agregar partidas por emparejamiento con `scoreSeries`, política para partidas anómalas, tests. Sin esto los resultados se registran a mano con `apply-overrides`.
2. **Bajas durante el torneo**: no hay acción "abandonar"; hoy se resuelve con walkovers cada ronda. Una baja en la fase suiza con buen récord podría ocupar plaza en el bracket (la librería la deja en la clasificación). Diseñar `drop-player` (Pokémon: quien abandona no entra en el top cut).
3. Confirmar con el usuario: corte de playoffs por defecto (8/16/16 vs top 8 de Pokémon), tope de inscritos (`playerCap.max` subido a 64) y que no haya partido por el 3.er puesto.
3. Subir todo (incluidos los lockfiles), *Settings -> Pages -> Source = GitHub Actions*, etiqueta `registration`; probar el registro con jugadores reales de prueba (`docs/ORGANIZADOR.md` §2) y confirmar que el redespliegue del bot funciona.
4. Probar el pipeline de registro con issues reales (válido, inválido, duplicado, registro cerrado) y `advance-round.yml` dos veces seguidas (el `concurrency group` debe serializarlas).
5. Sync con partidas reales de rapid una vez hecho el punto 1, y un simulacro con un torneo pequeño antes del real.
6. Opcional: Issue Form para overrides, proceso de cambio de username (no hay lookup inverso en la API), aviso automático cuando algo cae en `needs-review.json`, calendario/plazos por ronda (con rondas de 2 semanas, 20 jugadores son 8 rondas ≈ 16 semanas y 40-60 jugadores 10 rondas ≈ 20 semanas).

Trade-offs aceptados (no son bugs): rate limiting de chess.com sin límite publicado (backoff, caché por ejecución, cron horario); número impar de jugadores delegado a los byes de la librería (verificado: un bye por ronda y nadie repite); el bot necesita permisos de escritura activados a mano una vez; el Issue Form pide consentimiento explícito y nunca guarda email ni datos sensibles.
