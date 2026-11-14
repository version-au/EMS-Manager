# Changelog

## 0.16.0

- New sensor **`sensor.ems_manager_active_schedule`**, published to Home
  Assistant every poll. Its state is the active schedule's name, or
  `Fallback`, `Paused` or `Idle`. Attributes include the EMS mode being
  held. See the README for dashboard card examples.
- The Status tab now shows the EMS mode currently being held (`ems_mode`).

## 0.15.0

- New **Fallback** card in Setup: an EMS mode and limits that are applied
  whenever no schedule is active, so the inverter goes back to normal
  (e.g. Maximum Self Consumption / Auto) without a filler schedule.
- The Schedules timeline fills the gaps between schedules with a faded
  **Fallback** block when the fallback is on.
- The status pill at the top shows **Fallback active** and its mode.
- The fallback is included in backups (older backups restore it as off).

## 0.14.0

- New **Ramp export based on solar input** switch on schedules using
  Sigenergy Command Discharging (PV First / ESS First) or GoodWe Sell
  power. While solar minus house consumption is above the export limit,
  the export limit is raised to match, then drops back to the schedule's
  setting as solar falls. Only the export limit is changed.
- New optional **Solar (PV) power** sensor in Setup, used by the above.
- Values written to number entities are now kept within each entity's
  own maximum.

## 0.13.0

- GoodWe: **EMS power limit (kW)** field for schedules in Auto and other
  modes that aren't charging or discharging.

## 0.12.0

- GoodWe: added the **Sell power** and **Buy power** EMS modes.

## 0.11.1

- **24-hour time** switch in the schedule editor for typing times as HH:MM.

## 0.11.0

- 24-hour timeline on the Schedules tab, coloured by EMS mode.
- Full-screen schedule editor; each schedule saves on its own.
- Reorder button, and phone / Home Assistant app layout fixes.

## 0.10.0

- On/Off switch for each schedule and a **Pause scheduling** button.

## 0.9.x

- GoodWe inverter support, selected under Setup → System.
- Power entities are converted using each entity's own unit (W or kW).
- The inverter type is saved as soon as it's changed (0.9.1).
- GoodWe: only the power fields that apply to the EMS mode are shown (0.9.2).

## 0.8.0

- Backup & restore of entities, settings and schedules.

## 0.7.0

- Tabbed layout (Setup / Schedules / Status) with collapsible schedules.

## 0.6.x

- Export limit split into a Min/Max range for discharge schedules, and a
  flat Export limit for every other mode.

## 0.5.1

- Fixed new schedules sometimes being saved with the id "undefined".
