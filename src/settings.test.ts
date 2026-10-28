import { expect, test } from "bun:test";
import { readHome, readSettings } from "./settings";

const valid = { AIR_HOME_LAT: "32.8", AIR_HOME_LON: "35.1", AIR_LOCAL_STATION_IDS: "602,88,97" };

test("station discovery only needs the location, before station IDs have been chosen", () => {
  expect(readHome({ AIR_HOME_LAT: "0", AIR_HOME_LON: "-75" })).toEqual({ lat: 0, lon: -75 });
});

test("coordinates are required; errors name the missing setting without echoing private values", () => {
  expect(() => readSettings({})).toThrow("AIR_HOME_LAT");
  expect(() => readSettings({ ...valid, AIR_HOME_LON: "" })).toThrow("AIR_HOME_LON");
  expect(() => readSettings({ ...valid, AIR_HOME_LAT: undefined })).toThrow("AIR_HOME_LAT");
});

test("coordinates accept zero and negative values and reject malformed or out-of-range input", () => {
  expect(readSettings({ ...valid, AIR_HOME_LAT: "0", AIR_HOME_LON: "-75.25" }).home).toEqual({ lat: 0, lon: -75.25 });
  for (const value of [" ", "NaN", "Infinity", "32.8north", "91", "-91", "0x20"]) {
    expect(() => readSettings({ ...valid, AIR_HOME_LAT: value })).toThrow("AIR_HOME_LAT");
  }
  for (const value of ["181", "-181", "35.1east"]) expect(() => readSettings({ ...valid, AIR_HOME_LON: value })).toThrow("AIR_HOME_LON");
  expect(readSettings({ ...valid, AIR_HOME_LAT: "-90", AIR_HOME_LON: "180" }).home).toEqual({ lat: -90, lon: 180 });
});

test("each deployment chooses local stations, optional wind stations fall back to forecast", () => {
  const settings = readSettings(valid);
  expect(settings.localStationIds).toEqual([602, 88, 97]);
  expect(settings.windStationIds).toEqual([]);
  expect(readSettings({ ...valid, AIR_LOCAL_STATION_IDS: " 602, 88,602 " }).localStationIds).toEqual([602, 88]);
  expect(readSettings({ ...valid, AIR_WIND_STATION_IDS: "88,97" }).windStationIds).toEqual([88, 97]);
  for (const ids of [undefined, "", "602,", "0", "-1", "1.5", "abc"]) {
    expect(() => readSettings({ ...valid, AIR_LOCAL_STATION_IDS: ids })).toThrow("AIR_LOCAL_STATION_IDS");
  }
  expect(() => readSettings({ ...valid, AIR_WIND_STATION_IDS: "bad" })).toThrow("AIR_WIND_STATION_IDS");
});

test("the default header is generic and a display name never exposes coordinates", () => {
  expect(readSettings(valid).place).toBe("איכות האוויר");
  expect(readSettings({ ...valid, AIR_PLACE: "  My city  " }).place).toBe("My city");
  expect(readSettings({ ...valid, AIR_PLACE: " " }).place).toBe("איכות האוויר");
});

test("the radius is positive and every source station list is opt-in", () => {
  expect(readSettings(valid).localRadiusKm).toBe(3);
  expect(readSettings(valid).bazanStationIds).toEqual([]);
  expect(readSettings(valid).tashanStationIds).toEqual([]);
  expect(readSettings({ ...valid, AIR_LOCAL_RADIUS_KM: "4.5", AIR_BAZAN_STATION_IDS: "415,594", AIR_TASHAN_STATION_IDS: "627,628,629" })).toMatchObject({ localRadiusKm: 4.5, bazanStationIds: [415, 594], tashanStationIds: [627, 628, 629] });
  for (const value of ["0", "-1", "NaN", "", "3km"]) expect(() => readSettings({ ...valid, AIR_LOCAL_RADIUS_KM: value })).toThrow("AIR_LOCAL_RADIUS_KM");
  expect(() => readSettings({ ...valid, AIR_BAZAN_STATION_IDS: "bad" })).toThrow("AIR_BAZAN_STATION_IDS");
  expect(() => readSettings({ ...valid, AIR_TASHAN_STATION_IDS: "-2" })).toThrow("AIR_TASHAN_STATION_IDS");
});
