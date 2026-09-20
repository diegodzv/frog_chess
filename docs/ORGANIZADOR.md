# Guía del organizador

Cómo se maneja el torneo de principio a fin. Todo se hace desde GitHub (navegador): no hay servidor que mantener.

- Repositorio: <https://github.com/diegodzv/frog_chess>
- Web del torneo: <https://diegodzv.github.io/frog_chess/>
- Acciones (donde lanzas los botones): <https://github.com/diegodzv/frog_chess/actions>

## Quién hace qué

| | Jugadores | Bot (GitHub Actions) | Tú (organizador) |
|---|---|---|---|
| Inscripción | Rellenan el formulario | Valida el usuario en chess.com y lo añade | Nada (solo vigilar) |
| Empezar el torneo | | | Botón **start-tournament** |
| Jugar las series | Se retan en chess.com | | |
| Registrar resultados | | (automático: pendiente, ver el final) | Escribir en `data/overrides.json` + botón **apply-overrides** |
| Pasar de ronda | | | Botón **next-round** |
| Publicar la web | | Se redespliega sola tras cada cambio | |

Los datos viven en `data/*.json` dentro del repo: cada cambio es un commit, así que todo queda auditado y se puede deshacer.

## 1. Puesta en marcha (una sola vez)

1. **Subir el código** a `main` (el primer commit ya está; sube el resto). Antes de `git add -A`, comprueba con `git status` que no aparecen `battle_subway_helper/`, `sim/` ni `node_modules/`.
2. **Activar Pages**: *Settings → Pages → Build and deployment → Source = **GitHub Actions***. Hazlo *antes* del primer push (o relanza después *Actions → Deploy Pages → Run workflow*).
3. **Permisos**: los workflows ya piden los permisos que necesitan. Si un run falla con un 403 al hacer push, activa *Settings → Actions → General → Workflow permissions → Read and write permissions*.
4. **Etiqueta de inscripción**: *Issues → Labels → New label* con nombre `registration`. (El formulario solo la añade si ya existe; el workflow también reconoce el prefijo `[Inscripción]` del título, así que no es crítica.)
5. **Comprobar** en la pestaña *Actions* que salen en verde `CI` y `Deploy Pages`, y que abre <https://diegodzv.github.io/frog_chess/>.

Cada repo tiene su propio Pages: este no interfiere con `battle_subway_helper` ni hay que hacer privado ninguno (en el plan gratuito, un repo privado pierde su Pages).

## 2. Probar la inscripción con jugadores de prueba

1. Cada persona abre la web → **Inscripción** → *Inscribirme* (o directamente *Issues → New issue → Inscripción al torneo*) y rellena nombre + usuario de chess.com.
2. En 1-2 minutos el bot comenta en el issue, lo etiqueta `registered` y lo cierra. Comprueba también:
   - en el repo aparece un commit `registro: añadir a …` del usuario `frog-chess-bot`, y `data/players.json` tiene al jugador;
   - unos minutos después, la web (**Inscripción**) muestra `N / 64 plazas` y el nombre en la lista.
3. Casos que conviene probar a propósito:
   - usuario de chess.com inexistente → el bot comenta el motivo y pone `needs-changes`; el jugador **edita el issue** para reintentar;
   - el mismo usuario dos veces → rechazado;
   - editar un issue ya aceptado → no pasa nada (no duplica);
   - más de 64 inscritos → rechazado por aforo.
4. Si algo falla, abre el run en *Actions → Register player* y mira el log. Si chess.com devolviera un error a los servidores de GitHub, el jugador verá "No se pudo consultar chess.com… reintenta"; si ocurre siempre, avísame (habría que registrar a mano).

**Bajas antes de empezar**: edita `data/players.json` (lápiz en GitHub) y cambia `"status": "active"` por `"status": "withdrawn"` del jugador; luego *Actions → Advance tournament → Run workflow → `rebuild-public-data`* para refrescar la web. Un jugador dado de baja puede volver a inscribirse.

**Registrar a alguien a mano** (si el bot no pudiera): añade en `data/players.json`

```json
{ "id": "p_ada-lovelace-1", "name": "Ada Lovelace", "chesscomUsername": "adalovelace", "status": "active" }
```

y lanza `rebuild-public-data`.

## 3. Cerrar la inscripción y empezar

Cuando estén todos: *Actions → Advance tournament → Run workflow → `start-tournament`*.

- Cierra la inscripción y fija el formato según los inscritos: rondas suizas = `ceil(log2 n)` (20 → 5, 40 → 6, 60 → 6) y corte a eliminatorias (20 → 8, 40 → 16, 60 → 16). Ajustable en `data/tournament.json` **antes** de empezar (`swissRounds`, `playoffCutoff.value`; el corte debe ser potencia de 2).
- Mínimo 8 jugadores.
- La ronda 1 se sortea al azar. Con número impar, un jugador al azar descansa (**bye**) y esa ronda le cuenta como victoria; en las rondas siguientes el bye va al **peor récord que aún no lo haya tenido** (nadie descansa dos veces), como en los torneos de Pokémon.

## 4. Cada ronda

Todas las series son al mejor de 3 (semifinales y final al mejor de 5): **gana quien primero llegue a 2 victorias (3 en Bo5). Las tablas no cuentan: se juega otra partida.**

1. Los jugadores miran su cruce en la web (**Rondas**), donde aparece el usuario de chess.com de su rival, y se retan en chess.com. Los plazos de cada ronda los comunicas tú (la web no los impone).
2. **Registrar resultados.** Mientras la detección automática no esté lista (ver el final), los apuntas tú en `data/overrides.json` (GitHub → el fichero → lápiz). Por usuarios de chess.com, sin ids:

   ```json
   {
     "overrides": [
       { "winner": "adalovelace", "loser": "bob", "reason": "2-1 https://www.chess.com/game/live/123456" },
       { "winner": "carl", "loser": "dana", "reason": "dana no se presentó" },
       { "players": ["erin", "frank"], "outcome": "double_forfeit", "reason": "ninguno jugó" }
     ]
   }
   ```

   - `winner`/`loser`: la serie se registra como ganada por el `winner` (2-0 en Bo3, 3-0 en Bo5). Sirve tanto para resultados normales como para un no-presentado.
   - `double_forfeit`: no ganó nadie (0 puntos y derrota para ambos). Solo en la fase suiza.
   - Mayúsculas/minúsculas y espacios no importan. `reason` es opcional.
   - Un mismo emparejamiento solo se puede resolver una vez.
3. *Actions → Advance tournament → Run workflow → **`apply-overrides`***: aplica los resultados **sin pasar de ronda** y la web se actualiza. Puedes repetirlo cuantas veces quieras durante la ronda. Si alguna entrada no coincide con ninguna partida pendiente (usuario mal escrito…), el log del run muestra un aviso y esa entrada se queda sin aplicar.
4. Cuando todas las series de la ronda estén resueltas: **`next-round`** (cierra la ronda y empareja la siguiente). Si quedan partidas sin jugar y ya has añadido sus overrides (walkovers), usa **`force-next-round`**, que aplica los overrides pendientes y avanza de golpe. Si aún falta alguna, el run falla con la lista de partidas pendientes y **no cambia nada**.

Después de la última ronda suiza, `next-round` construye el bracket con los mejores clasificados (sembrados por su puesto: 1.º contra el último, etc.).

## 5. Eliminatorias

Igual que arriba, ronda a ronda (`apply-overrides` y `next-round`). En el bracket no hay empates ni doble forfeit: alguien tiene que avanzar (usa `winner`/`loser`). Tras la final, `next-round` marca el torneo como **finalizado** y la web muestra al campeón.

## 6. Si algo sale mal

- **Un run falla**: *Actions → el run → el paso en rojo*. Los errores están en español y dicen qué hacer.
- **La web no se actualiza**: espera 1-2 minutos y recarga con Ctrl+F5. Si tras un cambio de datos no hay run de *Deploy Pages*, lánzalo a mano (*Run workflow*).
- **Edición manual de `data/`**: seguro para `players.json` (bajas/altas) y `overrides.json`. **No edites** `engine-state.json` (es el estado del motor) ni `data/public/` (se regenera solo).
- **Editar en local**: haz siempre `git pull` antes; el bot hace commits mientras tanto.
- **Reiniciar tras las pruebas**: en tu equipo, `cd scripts && npm run reset -- --yes --keep-players` (o sin `--keep-players` para vaciar también la lista), revisa `git diff` y sube el commit. Vuelve a fase de inscripción.

## 7. Lo que aún no hace

- **Detección automática de resultados** en chess.com para series Bo3/Bo5 (hoy `sync-results` no resuelve nada en esas rondas; se hace a mano como en el punto 4).
- **Bajas durante el torneo**: no hay un botón "abandonar". Si alguien se va a mitad, sus rivales ganan por walkover cada ronda (o `double_forfeit`); si se clasificara al bracket habría que darle walkover al rival.
- Recordatorios a los jugadores, plazos por ronda impuestos, ni cambio de usuario de chess.com a mitad de torneo.
