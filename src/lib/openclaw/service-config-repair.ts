import { invokeWithAuthRetry } from "../tauri-invoke";

export type ServiceConfigRepairResult = {
  changed: boolean;
  browserProfilesRepaired: boolean;
  compatRepaired: boolean;
  doctorRan: boolean;
  doctorOk: boolean;
  message: string;
};

/** 修复服务配置文件（浏览器颜色、兼容项、内置诊断）。 */
export async function repairServiceConfig(): Promise<ServiceConfigRepairResult> {
  return invokeWithAuthRetry<ServiceConfigRepairResult>("yuntuai_repair_service_config", {});
}
