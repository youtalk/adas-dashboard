# Safety Island adapter (design section 15). Build from the repository root:
#   docker build -f adapters/safety_island/Dockerfile -t adas-dashboard-si .
FROM ros:jazzy-ros-base
# autoware_msgs 1.13.0, pinned so a rebuild reproduces the same Control definition.
ARG AUTOWARE_MSGS_REF=bb8e7bf5d97168663e0e7b357929e4fcdbd3a967
SHELL ["/bin/bash", "-c"]
RUN apt-get update && apt-get install -y --no-install-recommends \
      ros-jazzy-rmw-cyclonedds-cpp python3-colcon-common-extensions python3-pip git build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages "websockets>=13"
WORKDIR /ws
RUN git init src/autoware_msgs \
    && git -C src/autoware_msgs remote add origin https://github.com/autowarefoundation/autoware_msgs.git \
    && git -C src/autoware_msgs fetch --depth 1 origin ${AUTOWARE_MSGS_REF} \
    && git -C src/autoware_msgs checkout FETCH_HEAD \
    && source /opt/ros/jazzy/setup.bash \
    && colcon build --packages-up-to autoware_control_msgs \
    && rm -rf build log src
COPY adapters /app/adapters
WORKDIR /app
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp ROS_DOMAIN_ID=1
ENTRYPOINT ["/bin/bash", "-c", "source /ws/install/setup.bash && exec python3 -m adapters.safety_island.si_adapter \"$@\"", "--"]
