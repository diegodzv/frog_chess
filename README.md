# Frog Chess

Torneo de ajedrez de la oficina, jugado en chess.com: seis rondas suizas y eliminatorias.

- Web del torneo: <https://diegodzv.github.io/frog_chess/>
- Normas: <https://diegodzv.github.io/frog_chess/normas.html> (se generan desde [`NORMAS.md`](NORMAS.md))

## Llevar el torneo

Todo se hace desde GitHub, en el navegador: los botones están en *Actions → Advance tournament → Run workflow*. La guía paso a paso está en [`docs/ORGANIZADOR.md`](docs/ORGANIZADOR.md). En resumen:

1. **Inscripción**: los jugadores rellenan el Microsoft Forms. Exporta las respuestas a CSV, impórtalas con `node scripts/import-players.mjs <fichero.csv>`, sube el cambio y lanza **check-players**.
2. **Empezar**: **start-tournament** (lunes 9 de noviembre, antes de las 9:00).
3. **Cada lunes, antes de las 9:00**: **next-round** cierra la ronda y empareja la siguiente. Los resultados se leen solos de chess.com cada hora.
4. **Sorteos tras tablas, partidas no jugadas y abandonos**: se apuntan en `data/overrides.json` y se aplican con **apply-overrides** (o **force-next-round** el lunes).

## Simular un torneo

Para ver cómo queda la web con jugadores y partidas inventados, sin tocar los datos reales. Necesitas [Node.js](https://nodejs.org) 20 o superior.

```bash
cd scripts
npm install
node dev/simulate-tournament.mjs        # torneos de 20, 40 y 60 jugadores

cd ../web
npm install
npm run dev
```

Abre <http://localhost:5173/> y elige la simulación en el selector **Datos** de la barra superior. Para otro número de jugadores: `node dev/simulate-tournament.mjs --players=32`. Para verlo desde otro ordenador de la misma red: `npm run dev -- --host`.
