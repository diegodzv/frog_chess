# Frog Chess

Torneo de ajedrez de oficina jugado en chess.com: rondas suizas + fase eliminatoria, repartido a lo largo de varios meses.

Arquitectura: sitio estático (GitHub Pages) + JSON versionado en `data/` como "base de datos" + GitHub Actions como "backend". Sin servidor propio, sin coste.

## Estado de este scaffold

Este proyecto se generó en una máquina sin `node`/`npm`/`git` instalados, así que **nada de esto se ha instalado, ejecutado ni verificado todavía**. Antes de fiarte de él:

1. Clona/copia esta carpeta a una máquina con Node 20+, npm y git (idealmente fuera de una red que bloquee chess.com).
2. `git init && git add -A && git commit -m "scaffold inicial"`.
3. `cd scripts && npm install` (genera `scripts/package-lock.json`) — **luego ejecuta `npm run spike`** y revisa la salida contra los comentarios de `scripts/dev/spike-tournament-organizer.mjs`: confirma cómo `tournament-organizer` dispara la transición suizo→eliminación y el manejo de byes antes de fiarte de `advance-tournament.mjs` en producción.
4. `cd scripts && npm test` — deberían pasar los tests de `chesscomClient` y `resultMatcher` (no dependen de red); los de `tournamentEngine` dependen de que `tournament-organizer` esté instalado y se comporte como se asumió.
5. `cd web && npm install` (genera `web/package-lock.json`), `npm run dev` para ver el sitio local.
6. Edita `web/src/config.js` con la URL real del repo una vez lo crees en GitHub.
7. En GitHub: Settings → Pages → Source = **GitHub Actions**; Settings → Actions → General → Workflow permissions = **Read and write permissions**.
8. Ajusta `data/tournament.json` (nombre del torneo, `timeClass`, número de rondas suizas, corte de playoffs, aforo).

## Cómo funciona

- **Inscripción**: cada jugador abre un issue con la plantilla "🐸 Inscripción al torneo" (nombre + usuario de chess.com). El workflow `register-player.yml` lo valida contra la API de chess.com y lo añade a `data/players.json`.
- **Inicio del torneo**: un organizador dispara manualmente el workflow `advance-round.yml` con `action=start-tournament` (pestaña Actions → Advance tournament → Run workflow).
- **Durante una ronda**: `sync-results.yml` corre cada hora (y también manualmente) y detecta resultados de partidas jugadas en chess.com que encajen con los emparejamientos activos. Nunca adivina: partidas ambiguas o sin jugar quedan pendientes.
- **Avanzar de ronda**: el organizador dispara `advance-round.yml` con `action=next-round` cuando todas las partidas de la ronda están resueltas, o `action=force-next-round` tras rellenar `data/overrides.json` para las partidas que falten (walkover, no-show, etc.).
- **Web**: se despliega sola en cada push a `main` que toque `data/public/**` o `web/**`.

## Limitaciones conocidas

- La API de chess.com no tiene CORS: solo se puede llamar desde Node (Actions o scripts locales), nunca desde el navegador directamente.
- El cortafuegos de la oficina bloquea chess.com (categoría "gaming"): no afecta a las Actions (corren fuera de la red de la oficina), pero sí a pruebas locales (`npm run smoke:chesscom`, el spike) hechas desde un equipo de trabajo — usa red doméstica/móvil para eso.
- El repo debe ser público para usar GitHub Pages gratis: nombres y usuarios de chess.com quedan visibles públicamente (el issue de inscripción pide consentimiento explícito).
