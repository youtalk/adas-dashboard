# Camera PiP source: MJPEG of a camera topic, raw or compressed (design section 15). Build:
#   docker build -t adas-dashboard-camera adapters/carla/camera
FROM ros:jazzy-ros-base
RUN apt-get update && apt-get install -y --no-install-recommends \
      ros-jazzy-web-video-server ros-jazzy-rmw-cyclonedds-cpp \
    && rm -rf /var/lib/apt/lists/*
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp ROS_DOMAIN_ID=1
ENTRYPOINT ["/bin/bash", "-c", "source /opt/ros/jazzy/setup.bash && exec ros2 run web_video_server web_video_server \"$@\"", "--"]
