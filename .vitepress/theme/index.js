import DefaultTheme from "vitepress/theme";
import "./custom.css";
import CodeBrowser from "./components/CodeBrowser.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("CodeBrowser", CodeBrowser);
  },
};
