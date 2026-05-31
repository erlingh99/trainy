import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import sv from "./locales/sv/common.json";
import nb from "./locales/nb/common.json";
import en from "./locales/en/common.json";

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        sv: { common: sv },
        nb: { common: nb },
        en: { common: en },
      },
      fallbackLng: "sv",
      supportedLngs: ["sv", "nb", "en"],
      defaultNS: "common",
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
        lookupLocalStorage: "lang",
      },
    });
} else {
  // HMR: locale JSON files changed — push updated bundles into the live instance
  i18n.addResourceBundle("sv", "common", sv, true, true);
  i18n.addResourceBundle("nb", "common", nb, true, true);
  i18n.addResourceBundle("en", "common", en, true, true);
}

export default i18n;
