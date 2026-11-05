export {
  AUTO_MODEL_ID,
  DEFAULT_MODEL_ID,
  type CatalogModel,
  type ModelCapability,
  type ModelProvider,
  type ModelProviderGroup,
  type ModelSelectionId,
  type ModelSwitchResult,
} from "../../types/model";

export {
  INTERNAL_MODEL_CATALOG,
  /** @deprecated 使用 INTERNAL_MODEL_CATALOG */
  INTERNAL_MODEL_CATALOG as DEEPSEEK_DIRECT_MODEL_CATALOG,
  RELAY_MODEL_CATALOG,
  catalogForProfile,
  buildModelMenuEntries,
  displayLabelForSelection,
  getCatalogModel,
  listModelProviderGroups,
  resolveSelectionToModelId,
  resolveVendorForSelection,
} from "./catalog";

export {
  getActiveModelForRequest,
  getResolvedModelId,
  getSelectionDisplayLabel,
  persistSelection,
  pullBackendModelSelection,
  readPersistedSelection,
  switchModel,
} from "./model-api";
