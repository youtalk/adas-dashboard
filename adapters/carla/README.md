# CARLA adapter

Serves the `vehicle` and `map` roles on one endpoint, `world`, from a CARLA 0.10 server (design section 15).

Run it from the repository root on the CARLA host. Use the client module from the server's own tree. On the CES bench that is `~/carla-venv` against the `ue58-dev` package:

    ~/carla-venv/bin/pip install "websockets>=13"
    ~/carla-venv/bin/python -m adapters.carla.carla_adapter --carla 127.0.0.1:2000 --port 8091

The adapter never ticks the world. Another client must do it, on the bench `config_carla.py`. The adapter waits up to 180 s for the server and for the vehicle with `role_name` `hero`. Then it sends `ego` once per simulation step and `map` each time the ego moved 20 m. If CARLA stops or the hero vehicle disappears, the adapter exits with an error, and the page shows `vehicle link lost`.
