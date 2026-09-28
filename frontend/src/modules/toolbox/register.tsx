import type { ModuleRegistration } from "@/platform/modules/types";
import CalciumRoiPage from "./pages/calcium-roi/CalciumRoiPage";
import UnitConverterPage from "./pages/unit-converter/UnitConverterPage";

export const toolboxModule: ModuleRegistration = {
  moduleId: "toolbox",
  routes: [
    { moduleId: "toolbox", path: "/tools/calcium-roi", element: <CalciumRoiPage /> },
    { moduleId: "toolbox", path: "/tools/unit-converter", element: <UnitConverterPage /> },
  ],
};

export { CalciumRoiPage, UnitConverterPage };
