"""
Per-inverter-brand differences: which entities need mapping, what the EMS
mode select's options are, which of those count as charging/discharging
(for ramping), and how charge/discharge power is written.

Mode values must match the select entity's raw option strings exactly (what
HA stores as the entity state, not the translated label shown in the UI).
"""

PROFILES = {
    "sigenergy": {
        "label": "Sigenergy (Sigenergy-Local-Modbus)",
        "entities": [
            ["ems_mode_select", "EMS mode (select entity)", "select."],
            ["ems_mode_enable_switch", "Remote EMS enable (switch, optional)", "switch."],
            ["charge_limit_number", "Charge power limit (number entity)", "number."],
            ["discharge_limit_number", "Discharge power limit (number entity)", "number."],
            ["soc_sensor", "Battery SoC (sensor entity)", "sensor."],
            ["import_limit_number", "Grid import limit (number entity)", "number."],
            ["export_limit_number", "Grid export limit (number entity)", "number."],
            ["consumption_sensor", "Home consumption power (sensor entity, optional)", "sensor."],
            ["pv_power_sensor", "Solar (PV) power (sensor entity, optional)", "sensor."],
        ],
        "modes": [
            ["PCS Remote Control", "PCS Remote Control"],
            ["Standby", "Standby"],
            ["Maximum Self Consumption", "Maximum Self Consumption"],
            ["Command Charging (Grid First)", "Command Charging (Grid First)"],
            ["Command Charging (PV First)", "Command Charging (PV First)"],
            ["Command Discharging (PV First)", "Command Discharging (PV First)"],
            ["Command Discharging (ESS First)", "Command Discharging (ESS First)"],
            ["V2G", "V2G"],
        ],
        "discharge_modes": ["Command Discharging (PV First)", "Command Discharging (ESS First)"],
        "charge_modes": ["Command Charging (Grid First)", "Command Charging (PV First)"],
        # Modes that offer "Ramp export based on solar input": the export
        # limit is raised to cover solar surplus above it.
        "solar_export_modes": ["Command Discharging (PV First)", "Command Discharging (ESS First)"],
        # "separate": charge_limit_number / discharge_limit_number are
        # written independently, whatever the mode.
        "power_control": "separate",
        "has_import_limit": True,
        # The charge ramp paces this window field to hit the target SoC.
        "charge_ramp_field": "import_limit_kw",
    },
    "goodwe": {
        "label": "GoodWe (home-assistant-goodwe-inverter)",
        "entities": [
            ["ems_mode_select", "EMS mode (select entity)", "select.goodwe_ems_mode"],
            ["ems_power_limit_number", "EMS power limit (number entity)", "number.goodwe_ems_power_limit"],
            ["soc_sensor", "Battery SoC (sensor entity)", "sensor.goodwe_battery_state_of_charge"],
            ["export_limit_number", "Grid export limit (number entity)", "number.goodwe_grid_export_limit"],
            ["consumption_sensor", "Home consumption power (sensor entity, optional)", "sensor.goodwe_house_consumption"],
            ["pv_power_sensor", "Solar (PV) power (sensor entity, optional)", "sensor.goodwe_pv_power"],
        ],
        "modes": [
            ["auto", "Auto (self-use)"],
            ["battery_standby", "Battery standby"],
            ["conserve", "Conserve (charge from PV only)"],
            ["charge_battery", "Charge battery (PV first, grid tops up)"],
            ["import_ac", "Import AC (grid first)"],
            ["charge_pv", "Charge PV"],
            ["discharge_battery", "Discharge battery (battery first)"],
            ["export_ac", "Export AC (PV first, battery tops up)"],
            ["discharge_pv", "Discharge PV"],
            # Grid-side (meter) power control, as opposed to export_ac /
            # import_ac which hold the inverter's own AC output.
            ["sell_power", "Sell power (export to grid at set power)"],
            ["buy_power", "Buy power (import from grid at set power)"],
        ],
        "discharge_modes": ["discharge_battery", "export_ac", "discharge_pv", "sell_power"],
        "charge_modes": ["charge_battery", "import_ac", "charge_pv", "buy_power"],
        # In Sell power the grid export limit is what the inverter exports
        # at, so the solar ramp only needs to raise that.
        "solar_export_modes": ["sell_power"],
        # "shared": a single ems_power_limit_number sets the power for
        # whichever direction the current EMS mode runs in - charge power in
        # a charge mode, discharge power in a discharge mode.
        "power_control": "shared",
        "has_import_limit": False,
        # No import limit entity, so the charge ramp paces charge power
        # (the EMS power limit) directly instead.
        "charge_ramp_field": "charge_power_kw",
    },
}

DEFAULT_INVERTER = "sigenergy"


def get_profile(inverter_type: str | None) -> dict:
    return PROFILES.get(inverter_type or DEFAULT_INVERTER, PROFILES[DEFAULT_INVERTER])
