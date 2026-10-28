# Autoware adapter

Serves the dashboard from Autoware Universe topics (design section 5.4). One process serves three endpoints. Their ports match the default `public/config.json`:

- `stack` on port 8090: `objects`, `trajectory` and `status`.
- `world` on port 8091, roles `vehicle` and `map`: `ego` and `map`.
- `supervisor` on port 8092: `control`, and the `status` and `alerts` of the Autoware MRM (minimal risk maneuver).

When the `stack` endpoint closes, the page shows "Stack lost". The adapter keeps the endpoint open while it runs and never sends the `lost` mode.

## Topics

Every topic is an option with the default below. All positions are in Autoware's `map` frame.

| Message                         | Default topic (option)                                      | Notes                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ego`                           | `/localization/kinematic_state` (`--odometry`)              | The pose of `base_link`, the rear axle. The speed comes from the twist.                                                                                    |
| `ego`                           | `/vehicle/status/steering_status` (`--steering`)            | The tire angle, left positive.                                                                                                                             |
| `ego`                           | `/localization/acceleration` (`--acceleration`)             | The longitudinal acceleration.                                                                                                                             |
| `map`                           | the Lanelet2 file (`--map`)                                 | Lane lines and road edges within 200 m of the ego, sent again after 20 m of travel. Positions come from the `local_x` and `local_y` node tags.             |
| `objects`                       | `/perception/object_recognition/objects` (`--objects`)      | `PredictedObjects`. The class with the highest probability. The size comes from the box, or from the footprint for a polygon shape.                        |
| `trajectory`                    | `/planning/trajectory` (`--trajectory`)                     | From the point nearest the ego, at most 150 points. Autoware's plan starts a few meters behind the ego.                                                    |
| `status` (stack)                | `/api/operation_mode/state` (`--operation-mode`)            | `active` in autonomous mode, else `standby`. The speed limit is the `speed_limit` tag of the road lanelet under the ego. There is no latency.              |
| `control`                       | `--operation-mode` and `/api/fail_safe/mrm_state` (`--mrm`) | An MRM in progress gives `supervisor`. Local mode, or autonomous mode with Autoware control off, gives `driver`. Remote mode gives `remote`. Else `stack`. |
| `status`, `alerts` (supervisor) | `--mrm`                                                     | `active` and one `critical` alert during an MRM, else `standby` and no alert.                                                                              |

Stop mode is `stack`, because Autoware holds the vehicle before engage and after arrival.

## Lead vehicle

Autoware does not mark a lead vehicle. The adapter marks the nearest object ahead whose center is within half the vehicle width plus a margin of the trajectory. `distance_m` is the distance along the trajectory from the ego to that object. Autoware ends its plan at the stop point behind a car that it stops for. For this rule, the adapter extends the trajectory 15 m straight past its last point. `--vehicle-width` (default 1.9 m) also sets the trajectory width on the page. `--lead-margin` sets the margin (default 0.5 m).

## Build

Build the image from the repository root:

```sh
docker build -f adapters/autoware/Dockerfile -t adas-dashboard-autoware .
```

The image builds `autoware_msgs` 1.13.0 and `autoware_adapi_msgs` 1.9.2. If your Autoware uses other message versions, change the two `ARG` values.

The tests need no ROS. Run them from the repository root:

```sh
python3 -m pytest adapters/autoware
```

## Run next to Autoware

Use the DDS domain and the DDS configuration of the Autoware run, and the map that Autoware loaded:

```sh
docker run --rm --init --name dash-aw --network host \
  -e ROS_DOMAIN_ID=<domain> -e CYCLONEDDS_URI=file:///dds.xml \
  -v <dds configuration>:/dds.xml:ro -v <map directory>:/map:ro \
  adas-dashboard-autoware --map /map/lanelet2_map.osm \
  --name "Autoware Universe (rule-based)" --device "RTX 5090"
```

For the CARLA run script in `PythonAPI/examples/av_stacks/autoware/`, the domain is 42 and the DDS configuration is `<log directory>/dds/cyclonedds.xml`.

## Replay a recorded drive with a new plan

You can play a recorded drive and run only the planner again. The page then shows the new plan over the recorded perception and localization.

1. Start the map loaders and the planner with `use_sim_time`. Remap the planner output to a topic that the recording does not have.
2. Play the recording with `--clock`. Leave out its recorded trajectory topics, so that only the new plan exists.
3. Start the adapter with `--trajectory` set to the planner output. A recording often has the operation mode and the MRM state only under `/system/operation_mode/state` and `/system/fail_safe/mrm_state`. Give these names to `--operation-mode` and `--mrm`.

The adapter reads the operation mode and the MRM state as reliable, transient local topics. If the recording has another QoS profile, give these two topics reliable, transient local QoS with the `--qos-profile-overrides-path` option of `ros2 bag play`.

## Camera

`adapters/carla/camera` builds a `web_video_server` image. It serves any image topic on port 8080, on the same DDS domain and configuration as the adapter. For a raw `sensor_msgs/Image` topic, use `type=mjpeg`. For a `sensor_msgs/CompressedImage` topic, use `type=ros_compressed` and give the topic name without `/compressed`. The JPEG frames then pass through as they are.

A recording usually replays its cameras as best effort. Then also add `qos_profile=sensor_data` to the stream URL, because `web_video_server` subscribes as reliable by default:

```text
http://127.0.0.1:8080/stream?topic=/sensing/camera/front/image_raw&type=ros_compressed&qos_profile=sensor_data
```

Put the stream URL in `camera_url` of `config.json`.
