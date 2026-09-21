# ADAS dashboard

A browser page that shows what an automated driving stack sees, plans and does, for people who are not engineers. It takes a small set of JSON messages over WebSocket from four roles: the driving stack, the vehicle, the map, and a supervisor that can take control. Adapters exist for VisionPilot, CARLA and the Safety Island used in the Autoware Foundation CES 2027 demo. Any other stack, vehicle or map can feed it through the same messages.

The design, message schema, screen states and weekly milestones are in [docs/design.md](docs/design.md).

## Status

Design approved on 2026-09-21. Implementation runs from 2026-09-28 to 2026-10-30. Progress is tracked in the issue "Tracking: CES 2027 dashboard".

## Develop

Frontend, Node 22 or newer:

    npm ci
    npm run dev        # http://localhost:5173
    npm test
    npm run build      # static files in dist/

Tools, Python 3.12:

    python3 -m venv .venv && . .venv/bin/activate
    pip install -r tools/requirements.txt pre-commit
    pytest tools -q
    pre-commit install

Play the recording and open the page against it:

    python3 -m tools.replay stack=recordings/ces2027-kill-route/stack.jsonl:8090 world=recordings/ces2027-kill-route/world.jsonl:8091 --loop
    npm run dev

The page reads `public/config.json`, which points at those two ports. Add `?stack=ws://...` to the URL to override an endpoint. Record live endpoints with `python3 -m tools.record stack=ws://host:port/path --out recordings/<name>`. Validate any message with `tools/schema.py` against `schema/v1/`.

## License

Code is Apache-2.0, see [LICENSE](LICENSE). The vehicle meshes in `assets/meshes/` come from [autoware_perception_rviz_plugin](https://github.com/autowarefoundation/autoware_rviz_plugins/tree/main/autoware_perception_rviz_plugin) and are by Sebastian Preuße under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Recordings in `recordings/` are CC0.

Every commit needs a DCO sign-off (`git commit -s`).
