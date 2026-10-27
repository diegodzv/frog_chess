# Guía del organizador

Cómo se maneja el torneo de principio a fin. Casi todo se hace desde GitHub (navegador): no hay servidor que mantener. Las normas para los participantes están en el documento de normas del torneo.

- Repositorio: <https://github.com/diegodzv/frog_chess>
- Web del torneo: <https://diegodzv.github.io/frog_chess/>
- Acciones (donde lanzas los botones): <https://github.com/diegodzv/frog_chess/actions>

## Quién hace qué

| | Jugadores | Bot (GitHub Actions) | Tú (organizador) |
|---|---|---|---|
| Inscripción | Rellenan el Microsoft Forms | Comprueba los usuarios en chess.com (**check-players**) | Exportar el Excel e importarlo (`import-players`) |
| Empezar el torneo | | | Botón **start-tournament** |
| Jugar las partidas | Se retan en chess.com | | |
| Registrar resultados | | Cada hora lee chess.com y resuelve las partidas jugadas | Tablas a suertes, incomparecencias y cambios de rival en `data/overrides.json` + **apply-overrides** |
| Pasar de ronda (lunes 8:00) | | | Botón **next-round** / **force-next-round** |
| Publicar la web | | Se redespliega sola tras cada cambio | |

Los datos viven en `data/*.json` dentro del repo: cada cambio es un commit, así que todo queda auditado y se puede deshacer.

## 1. Puesta en marcha (una sola vez)

1. **Subir el código** a `main`. Antes de `git add -A`, comprueba con `git status` que no aparecen `battle_subway_helper/`, `sim/`, `node_modules/` ni ningún `.csv`/`.xlsx` de inscripciones.
2. **Activar Pages**: *Settings → Pages → Build and deployment → Source = **GitHub Actions***. Hazlo *antes* del primer push (o relanza después *Actions → Deploy Pages → Run workflow*).
3. **Permisos**: los workflows ya piden los permisos que necesitan. Si un run falla con un 403 al hacer push, activa *Settings → Actions → General → Workflow permissions → Read and write permissions*.
4. **Comprobar** en la pestaña *Actions* que salen en verde `CI` y `Deploy Pages`, y que abre <https://diegodzv.github.io/frog_chess/>.
5. **Ritmo de juego**: `data/tournament.json` → `timeClass`. En chess.com, 6+2 es `blitz` (menos de 10 minutos estimados por jugador); 10+0 o más es `rapid`. Solo cuentan las partidas de esa clase; si `requireRated` es `true`, además tienen que ser puntuables.

## 2. Inscripción con Microsoft Forms

### Crear el formulario

1. <https://forms.office.com> → **Nuevo formulario**. Título: «Inscripción Frog Chess».
2. Preguntas (el importador las encuentra por el título, respétalo):
   - **Nombre y apellidos** — Texto, obligatoria.
   - **Usuario de chess.com** — Texto, obligatoria. Subtítulo: «Tal y como aparece en tu perfil (también vale el enlace a tu perfil)».
   - **Consentimiento** — Elección, obligatoria, una opción: «Acepto que mi nombre y mi usuario de chess.com aparezcan en la web pública del torneo».
3. **Configuración** (⋯ → Configuración):
   - *Solo las personas de mi organización pueden responder* + *Registrar nombre*: así cada respuesta lleva el correo, que el importador usa para quedarse con la última respuesta de quien conteste dos veces (el correo nunca se guarda en el repo).
   - *Una respuesta por persona*: desmarcado, para que puedan corregir su usuario respondiendo otra vez.
   - *Fecha de finalización*: domingo 8 de noviembre, 23:59.
4. **Recopilar respuestas → Copiar vínculo**. Ese enlace va en el mensaje de Teams y, si quieres botón en la web, en `web/src/config.js` (`REGISTRATION_FORM_URL`).

### Importar las respuestas

1. En el formulario: **Respuestas → Abrir en Excel**. En Excel: *Archivo → Guardar como → CSV UTF-8 (delimitado por comas)*. Guárdalo **fuera del repo** (contiene correos).
2. En tu equipo, en `scripts/`:

   ```bash
   node import-players.mjs ~/Descargas/inscripcion.csv --dry-run   # ver qué haría
   node import-players.mjs ~/Descargas/inscripcion.csv             # escribir data/players.json
   ```

   El resumen lista los nuevos, los que ya estaban y las respuestas descartadas con el motivo (usuario mal escrito, el mismo usuario con dos personas, aforo). Importar el mismo fichero (o uno más largo) otra vez es seguro: solo añade lo nuevo.
3. `git diff data/` → commit → push. La web muestra a los inscritos al momento.
4. *Actions → Advance tournament → Run workflow → **`check-players`***: comprueba cada usuario nuevo en chess.com (desde la oficina no se puede: el cortafuegos bloquea chess.com) y corrige mayúsculas/minúsculas. Si alguno no existe, el run falla con la lista: corrige su usuario en `data/players.json` (o pon `"status": "withdrawn"`) y repite `check-players`. Con red sin cortafuegos puedes hacerlo en local con `--check` en el paso 2.

Puedes importar varias veces durante la semana de inscripción (por ejemplo, cada noche) para que la lista de la web vaya creciendo.

**Bajas antes de empezar**: en `data/players.json` cambia `"status": "active"` por `"status": "withdrawn"`; luego `rebuild-public-data`.

## 3. Cerrar la inscripción y empezar (lunes 9 de noviembre, 8:00)

*Actions → Advance tournament → Run workflow → `start-tournament`*.

- Se niega si queda algún usuario sin comprobar (`check-players`) o hay menos de 8 jugadores.
- Formato configurado en `data/tournament.json`: **6 rondas suizas** (`swissRounds`), cada una a **una sola partida** (`series.swiss: 1`). El corte a eliminatorias (`playoffCutoff.value`) es `auto` = mayor potencia de 2 ≤ n/2, entre 4 y 32 (20 → 8, 40 → 16, 60 → 16, 100 → 32); pon un número (potencia de 2) **antes** de empezar si preferís otro. Semifinales y final al mejor de 5 (`series.semifinal`, `series.final`); el resto de eliminatorias al mejor de 3 (`series.elimination`), cambiable antes de que empiecen.
- La ronda 1 se sortea al azar. Con número impar, un jugador descansa (**bye**, cuenta como victoria); después el bye va al peor récord que aún no lo haya tenido (nadie descansa dos veces).
- Desempate (**resistencia**): porcentaje de victorias medio de todos los rivales y, después, la resistencia media de los rivales.

Publica en Teams los emparejamientos de la web (**Rondas**).

## 4. Cada semana

La ronda va de lunes 8:00 a domingo 23:59. Para el bot, la ventana de la ronda empieza cuando pulsas `next-round` (o `start-tournament`) y termina cuando pulsas el siguiente: pulsa el lunes a las 8:00.

1. **Resultados automáticos.** Cada hora `sync-results` busca en chess.com las partidas entre cada pareja dentro de la ventana, con el ritmo del torneo, y resuelve las que tienen ganador. La web lo muestra en **Rondas**.
   - **Tablas**: la partida queda «Pendiente» con un ½. Si juegan otra, el bot la resuelve sola. Si lo echan a suertes, apunta el resultado (paso 2).
   - Partidas jugadas con otro ritmo, variante o sin puntuar (si se exige) **no cuentan**: aparecen en `data/needs-review.json` con el motivo `wrong_format`. Decide tú y apúntalo como override.
   - Códigos de resultado contradictorios → `needs-review.json` (`inconsistent_result_codes`).
2. **Resultados a mano** en `data/overrides.json` (GitHub → el fichero → lápiz), por usuarios de chess.com:

   ```json
   {
     "overrides": [
       { "winner": "adalovelace", "loser": "bob", "reason": "tablas, sorteo" },
       { "winner": "carl", "loser": "dana", "reason": "dana no jugó" },
       { "players": ["erin", "frank"], "outcome": "double_forfeit", "reason": "ninguno jugó" },
       { "swap": ["j1", "j3"], "reason": "sus rivales no contestan" }
     ]
   }
   ```

   - `winner`/`loser`: gana el `winner` (1-0 en la fase suiza). Para sorteos tras tablas y para incomparecencias.
   - `double_forfeit`: ninguno jugó; derrota para los dos. Solo en la fase suiza.
   - `swap` (**cambio de rival**, a partir del viernes 8:00): `j1` y `j3` pasan a jugar entre sí y sus rivales (`j2` y `j4`) entre sí. Se niega si alguna de las dos nuevas parejas ya se ha enfrentado (elige otro cambio) o si alguna partida ya tiene resultado. Con un número impar de afectados, el que sobra sigue con su rival original.
   - Mayúsculas/minúsculas y espacios no importan. `reason` es opcional. Cada entrada se aplica una vez.
3. *Actions → Advance tournament → Run workflow → **`apply-overrides`***: aplica las entradas **sin pasar de ronda** y la web se actualiza (avisa a los afectados de un cambio de rival). Las entradas que no coinciden con nada quedan sin aplicar y el log lo avisa.
4. **Lunes 8:00**: **`next-round`** cierra la ronda y empareja la siguiente. Si quedan partidas sin jugar, añade sus overrides (`winner`/`loser` o `double_forfeit`) y usa **`force-next-round`**. Si aún falta alguna, el run falla con la lista y **no cambia nada**.

Después de la 6.ª ronda suiza (domingo 20 de diciembre), `next-round` construye el cuadro de eliminatorias con los mejores clasificados (1.º contra el último, etc.). Hazlo cuando queráis empezar en enero: la ventana de la primera eliminatoria empieza en ese momento.

## 5. Eliminatorias

Igual que arriba, ronda a ronda. El bot agrega las partidas de cada serie (al mejor de 3 o 5; las tablas no cuentan) y la resuelve cuando alguien llega a las victorias necesarias. No hay empates ni doble forfeit: alguien tiene que avanzar. Tras la final, `next-round` marca el torneo como **finalizado** y la web muestra al campeón.

## 6. Estadísticas

La página **Estadísticas** se actualiza con cada partida que resuelve el bot: victoria más rápida (en jugadas y en tiempo), quién gana más rápido de media (desde 2 victorias), victoria con más material y más jaques mate. Solo nombra al ganador. No cuentan las partidas abandonadas, las de menos de 5 jugadas ni los resultados metidos a mano.

## 7. Si algo sale mal

- **Un run falla**: *Actions → el run → el paso en rojo*. Los errores están en español y dicen qué hacer.
- **La web no se actualiza**: espera 1-2 minutos y recarga con Ctrl+F5. Si tras un cambio de datos no hay run de *Deploy Pages*, lánzalo a mano (*Run workflow*).
- **Edición manual de `data/`**: seguro para `players.json` (bajas, usuarios) y `overrides.json`. **No edites** `engine-state.json` (es el estado del motor) ni `data/public/` (se regenera solo).
- **Editar en local**: haz siempre `git pull` antes; el bot hace commits mientras tanto.
- **Reiniciar tras las pruebas**: en tu equipo, `cd scripts && npm run reset -- --yes --keep-players` (o sin `--keep-players` para vaciar también la lista), revisa `git diff` y sube el commit. Vuelve a fase de inscripción.

## 8. Lo que aún no hace

- **Bajas durante el torneo**: no hay un botón «abandonar». Si alguien se va a mitad, sus rivales ganan por walkover cada ronda; si se clasificara al cuadro habría que darle walkover al rival.
- Recordatorios a los jugadores, plazos impuestos por la web, ni cambio de usuario de chess.com a mitad de torneo.
