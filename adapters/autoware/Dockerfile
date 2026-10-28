# Autoware adapter (adapters/autoware/README.md). Build from the repository root:
#   docker build -f adapters/autoware/Dockerfile -t adas-dashboard-autoware .
FROM ros:jazzy-ros-base
# autoware_msgs 1.13.0 and autoware_adapi_msgs 1.9.2, pinned to the versions in the Autoware image.
ARG AUTOWARE_MSGS_REF=bb8e7bf5d97168663e0e7b357929e4fcdbd3a967
ARG AUTOWARE_ADAPI_MSGS_REF=35a7aeb97dfbbbc363c49fc032ded0c8ba172e24
SHELL ["/bin/bash", "-c"]
RUN apt-get update && apt-get install -y --no-install-recommends \
      ros-jazzy-rmw-cyclonedds-cpp ros-jazzy-geographic-msgs \
      python3-colcon-common-extensions python3-pip git build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages "websockets>=13"
WORKDIR /ws
RUN for repo in "autoware_msgs ${AUTOWARE_MSGS_REF}" "autoware_adapi_msgs ${AUTOWARE_ADAPI_MSGS_REF}"; do \
      set -- $repo \
      && git init src/$1 \
      && git -C src/$1 remote add origin https://github.com/autowarefoundation/$1.git \
      && git -C src/$1 fetch --depth 1 origin $2 \
      && git -C src/$1 checkout FETCH_HEAD || exit 1; \
    done \
    && source /opt/ros/jazzy/setup.bash \
    && colcon build --packages-up-to autoware_perception_msgs autoware_planning_msgs \
      autoware_vehicle_msgs autoware_adapi_v1_msgs \
    && rm -rf build log src
COPY adapters /app/adapters
WORKDIR /app
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
ENTRYPOINT ["/bin/bash", "-c", "source /ws/install/setup.bash && exec python3 -m adapters.autoware.autoware_adapter \"$@\"", "--"]
