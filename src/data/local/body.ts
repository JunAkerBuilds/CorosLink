"use client";
import type { OwnMeasurement, ProfileEdit } from "@/data/body";
import { createStore } from "@/data/local/store";

/** Measurements typed in at a desk. They are laid over the sample history by `mergeMeasurements`. */
export const NO_MEASUREMENTS: OwnMeasurement[] = [];
export const ownMeasurements = createStore<OwnMeasurement[]>("body.measurements", NO_MEASUREMENTS);

/** Height, goal and goal weight as edited here, over the sample profile. */
export const NO_EDIT: ProfileEdit = {};
export const profileEdit = createStore<ProfileEdit>("body.profile", NO_EDIT);
