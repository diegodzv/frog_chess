# Frog Chess

Torneo de ajedrez de oficina jugado en chess.com: rondas suizas + fase eliminatoria, repartido a lo largo de varios meses.

Arquitectura: sitio estático (GitHub Pages) + JSON versionado en `data/` como "base de datos" + GitHub Actions como "backend". Sin servidor propio, sin coste.

## Estado

El backend (motor de torneo, ciclo de vida, datos públicos) y la web están verificados en local con tests (`cd scripts && npm test`) y con simulaciones de torneos completos. **Todavía no se ha probado nada en GitHub (workflows, formulario de inscripción, Pages) ni contra chess.com real.** Lo pendiente y los problemas conocidos están en `CLAUDE.md`.

1. Node 20+ y npm. `cd scripts && npm install && npm test`; `cd web && npm install && npm run dev`.
2. Antes de subir el repo, commitea los `package-lock.json` de `scripts/` y `web/` (los workflows usan `npm ci`).
3. Edita `web/src/config.js` (y el `USER_AGENT` de `scripts/lib/chesscomClient.mjs`) con la URL real del repo.
4. En GitHub: Settings → Pages → Source = **GitHub Actions**; Settings → Actions → General → Workflow permissions = **Read and write permissions**.
5. Ajusta `data/tournament.json` (nombre, `timeClass`, tope de jugadores; las rondas suizas y el corte a eliminatorias son `"auto"` y dependen del número de inscritos).

## Cómo llevar el torneo

Toda la operación (puesta en marcha en GitHub, inscripción, resultados, rondas, reinicio tras las pruebas) está en [`docs/ORGANIZADOR.md`](docs/ORGANIZADOR.md).

## Simular un torneo

`cd scripts && npm run sim` genera torneos completos con jugadores y partidas ficticias (20, 40 y 60 jugadores por defecto) en `sim/` y muestra estadísticas del formato. No toca `data/`. Para verlos: `cd web && npm run dev` y abre `index.html?data=sim/n40` (o usa el selector "Datos" de la barra superior). Opciones: `--players=32 --seed=7 --runs=500 --no-show=0.05`.

## Formato

- Fase suiza de `ceil(log2(n))` rondas y eliminatoria con los 4-16 mejores (potencia de 2, hasta n/2). Todos los emparejamientos son al mejor de 3 partidas salvo semifinales y final, al mejor de 5.
- Las tablas no cuentan: se juega otra partida hasta que alguien gana 2 (o 3 en Bo5). No hay encuentros empatados.

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
