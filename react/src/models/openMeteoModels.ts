import type { WeatherModel, ModelMetadata } from '../types';

export const DEFAULT_MODEL_CHAIN: WeatherModel[] = [
  { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
  { name: 'ICON-EU', max_forecast_horizon_hours: 120 },
  { name: 'GFS Seamless', max_forecast_horizon_hours: 384 }
];

export const DEFAULT_CLOUD_MODEL: WeatherModel = {
  name: 'ECMWF IFS 0.25°',
  id: 'ecmwf_ifs025',
  max_forecast_horizon_hours: 345,
  max_forecast_hours: 345,
  spatial_resolution_km: 25.0,
  temporal_resolution_hours: 1,
  provider: 'ECMWF',
  region: 'Global',
  supports_vertical_cloud_profile: true,
  supports_pressure_level_cloud_cover: true,
  supports_geopotential_height: true,
  pressure_levels_hpa: [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50]
};

export const DEFAULT_CLOUD_MODEL_CHAIN: WeatherModel[] = [DEFAULT_CLOUD_MODEL];

export const AVAILABLE_MODELS_METADATA: Record<string, ModelMetadata> = {
  'ICON-D2': {
    name: 'ICON-D2',
    id: 'icon_d2',
    max_forecast_horizon_hours: 48,
    spatial_resolution_km: 2.2,
    temporal_resolution_hours: 1,
    provider: 'DWD',
    region: 'Central Europe',
    supports_vertical_cloud_profile: true,
    supports_pressure_level_cloud_cover: true,
    supports_geopotential_height: true,
    pressure_levels_hpa: [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30]
  },
  'ICON-EU': {
    name: 'ICON-EU',
    id: 'icon_eu',
    max_forecast_horizon_hours: 120,
    spatial_resolution_km: 7.0,
    temporal_resolution_hours: 1,
    provider: 'DWD',
    region: 'Europe',
    supports_vertical_cloud_profile: true,
    supports_pressure_level_cloud_cover: true,
    supports_geopotential_height: true,
    pressure_levels_hpa: [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30]
  },
  'GFS': {
    name: 'GFS',
    id: 'gfs_seamless',
    max_forecast_horizon_hours: 384,
    spatial_resolution_km: 27.8,
    temporal_resolution_hours: 1,
    provider: 'NOAA',
    region: 'Global',
    supports_vertical_cloud_profile: true,
    supports_pressure_level_cloud_cover: true,
    supports_geopotential_height: true,
    pressure_levels_hpa: [1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 725, 700, 675, 650, 625, 600, 575, 550, 525, 500, 475, 450, 425, 400, 375, 350, 325, 300, 275, 250, 225, 200, 175, 150, 125, 100, 70, 50, 40, 30, 20, 15, 10]
  },
  'GFS Seamless': {
    name: 'GFS Seamless',
    id: 'gfs_seamless',
    max_forecast_horizon_hours: 384,
    spatial_resolution_km: 27.8,
    temporal_resolution_hours: 1,
    provider: 'NOAA',
    region: 'Global',
    supports_vertical_cloud_profile: true,
    supports_pressure_level_cloud_cover: true,
    supports_geopotential_height: true,
    pressure_levels_hpa: [1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 725, 700, 675, 650, 625, 600, 575, 550, 525, 500, 475, 450, 425, 400, 375, 350, 325, 300, 275, 250, 225, 200, 175, 150, 125, 100, 70, 50, 40, 30, 20, 15, 10]
  },
  'ECMWF-IFS': {
    name: 'ECMWF-IFS',
    id: 'ecmwf_ifs',
    max_forecast_horizon_hours: 240,
    spatial_resolution_km: 9.0,
    temporal_resolution_hours: 1,
    provider: 'ECMWF',
    region: 'Global',
    supports_vertical_cloud_profile: false,
    pressure_levels_hpa: []
  },
  'ECMWF IFS 0.25°': {
    name: 'ECMWF IFS 0.25°',
    id: 'ecmwf_ifs025',
    max_forecast_horizon_hours: 345,
    spatial_resolution_km: 25.0,
    temporal_resolution_hours: 1,
    provider: 'ECMWF',
    region: 'Global',
    supports_vertical_cloud_profile: true,
    supports_pressure_level_cloud_cover: true,
    supports_geopotential_height: true,
    pressure_levels_hpa: [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50]
  }
};
