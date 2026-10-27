# Frog Chess

Torneo de ajedrez de oficina jugado en chess.com: rondas suizas + fase eliminatoria.

Arquitectura: sitio estático (GitHub Pages) + JSON versionado en `data/` como "base de datos" + GitHub Actions como "backend". Sin servidor propio, sin coste.

## Estado

El backend (motor de torneo, ciclo de vida, datos públicos) y la web están verificados en local con tests (`cd scripts && npm test`) y con simulaciones de torneos completos. **Todavía no se ha probado nada en GitHub (workflows, formulario de inscripción, Pages) ni contra chess.com real.** Lo pendiente y los problemas conocidos están en `CLAUDE.md`.

1. Node 20+ y npm. `cd scripts && npm install && npm test`; `cd web && npm install && npm run dev`.
2. Antes de subir el repo, commitea los `package-lock.json` de `scripts/` y `web/` (los workflows usan `npm ci`).
3. En GitHub: Settings → Pages → Source = **GitHub Actions**; Settings → Actions → General → Workflow permissions = **Read and write permissions**.
4. Ajusta `data/tournament.json` (nombre, `timeClass` —6+2 es `blitz` en chess.com—, tope de jugadores, rondas suizas, corte a eliminatorias).

## Cómo llevar el torneo

Toda la operación (puesta en marcha en GitHub, inscripción, resultados, rondas, reinicio tras las pruebas) está en [`docs/ORGANIZADOR.md`](docs/ORGANIZADOR.md).

## Simular un torneo

`cd scripts && npm run sim` genera torneos completos con jugadores y partidas ficticias (20, 40 y 60 jugadores por defecto) en `sim/` y muestra estadísticas del formato. No toca `data/`. Para verlos: `cd web && npm run dev` y abre `index.html?data=sim/n40` (o usa el selector "Datos" de la barra superior). Opciones: `--players=32 --seed=7 --runs=500 --no-show=0.05`.

## Formato

- 6 rondas suizas semanales a una sola partida y eliminatoria con los mejores (potencia de 2, `auto` = hasta n/2 entre 4 y 32). Eliminatorias al mejor de 3, semifinales y final al mejor de 5.
- Las tablas no cuentan: se juega otra partida (o, en la fase suiza, se echa a suertes). No hay encuentros empatados.
- Desempate por resistencia: porcentaje de victorias medio de todos los rivales.

## Cómo funciona

- **Inscripción**: cada jugador rellena un Microsoft Forms (nombre + usuario de chess.com). El organizador exporta las respuestas e importa el CSV con `scripts/import-players.mjs`; la acción `check-players` comprueba los usuarios contra chess.com.
- **Inicio del torneo**: un organizador dispara manualmente el workflow `advance-round.yml` con `action=start-tournament` (pestaña Actions → Advance tournament → Run workflow).
- **Durante una ronda**: `sync-results.yml` corre cada hora (y también manualmente), agrupa las partidas de cada pareja en chess.com dentro de la ventana de la ronda y resuelve las series decididas. Nunca adivina: partidas inconsistentes o con otro ritmo van a revisión y las no jugadas quedan pendientes. También alimenta la página de estadísticas.
- **Avanzar de ronda**: el organizador dispara `advance-round.yml` con `action=next-round` cuando todas las partidas de la ronda están resueltas, o `action=force-next-round` tras rellenar `data/overrides.json` para las partidas que falten (sorteo tras tablas, incomparecencia, cambio de rival).
- **Web**: se despliega sola en cada push a `main` que toque `data/public/**` o `web/**`.

## Limitaciones conocidas

- La API de chess.com no tiene CORS: solo se puede llamar desde Node (Actions o scripts locales), nunca desde el navegador directamente.
- El cortafuegos de la oficina bloquea chess.com (categoría "gaming"): no afecta a las Actions (corren fuera de la red de la oficina), pero sí a pruebas locales (`npm run smoke:chesscom`, el spike) hechas desde un equipo de trabajo — usa red doméstica/móvil para eso.
- El repo debe ser público para usar GitHub Pages gratis: nombres y usuarios de chess.com quedan visibles públicamente (el issue de inscripción pide consentimiento explícito).
