# Safety Island adapter

Serves the `supervisor` role on the `supervisor` endpoint (design section 15). It listens on DDS domain 1 to `/control/trajectory_follower/control_cmd`, the command that the arbiter acts on. The Safety Island has control while its last command is at most 0.5 s old, the same rule as the arbiter.

Build the image from the repository root:

    docker build -f adapters/safety_island/Dockerfile -t adas-dashboard-si .

Run it on the CARLA host with the bench DDS configuration:

    docker run --rm --name dash-si --net=host \
      -e CARLA_BENCH_IF=enx00e04c680c75 -e CYCLONEDDS_URI=file:///dds.xml \
      -v <bench>/si/cyclonedds-bench.xml:/dds.xml:ro \
      adas-dashboard-si --stack-name VisionPilot --port 8092

`<bench>` is the bench copy of `Simulation/CARLA/ROS2` from the vision_pilot repository. The adapter does not read the Cortex-R52 serial console, so the page does not show why the Safety Island took over.
