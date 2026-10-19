# CARLA adapter

Serves the `vehicle` and `map` roles on one endpoint, `world`, from a CARLA 0.10 server (design section 15).

Run it from the repository root on the CARLA host. Use the client module from the server's own tree. On the CES bench that is `~/carla-venv` against the `ue58-dev` package:

    ~/carla-venv/bin/pip install "websockets>=13"
    ~/carla-venv/bin/python -m adapters.carla.carla_adapter --carla 127.0.0.1:2000 --port 8091

The adapter never ticks the world. Another client must do it, on the bench `config_carla.py`. The adapter waits up to 180 s for the server and for the vehicle with `role_name` `hero`. Then it sends `ego` once per simulation step and `map` each time the ego moved 20 m. If CARLA stops or the hero vehicle disappears, the adapter exits with an error, and the page shows `vehicle link lost`.

## Camera

The camera PiP of the page shows CARLA's camera topic `/carla/hero/main_cam/image` as an MJPEG stream from `web_video_server`. Build the image once on the CARLA host, then run it next to the adapter:

    docker build -t adas-dashboard-camera adapters/carla/camera
    docker run -d --rm --name dash-camera --net=host \
      -e CYCLONEDDS_URI=file:///dds.xml -v "$ROS2/si/cyclonedds-bench.xml":/dds.xml:ro \
      adas-dashboard-camera

`$ROS2` is the bench copy of `Simulation/CARLA/ROS2` from vision_pilot. The server listens on port 8080 and reads DDS domain 1. The `camera_url` in `public/config.json` points at it.
