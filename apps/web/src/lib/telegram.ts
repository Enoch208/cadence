type TelegramWebApp = { initData: string; ready: () => void };

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
    cadenceTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}

function loadScript(
  src: string,
  attributes: Record<string, string> = {},
  parent: HTMLElement = document.head,
) {
  return new Promise<HTMLScriptElement>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    for (const [name, value] of Object.entries(attributes)) {
      script.setAttribute(name, value);
    }
    script.addEventListener("load", () => {
      resolve(script);
    });
    script.addEventListener("error", () => {
      reject(new Error(`Could not load ${src}`));
    });
    parent.appendChild(script);
  });
}

export async function miniAppInitData(): Promise<string | null> {
  await loadScript("https://telegram.org/js/telegram-web-app.js?59");
  const webApp = window.Telegram?.WebApp;
  if (!webApp || webApp.initData.length === 0) {
    return null;
  }
  webApp.ready();
  return webApp.initData;
}

export function mountLoginWidget(
  container: HTMLElement,
  botUsername: string,
  onAuth: (fields: Record<string, string>) => void,
) {
  window.cadenceTelegramAuth = (user) => {
    onAuth(Object.fromEntries(Object.entries(user).map(([key, value]) => [key, String(value)])));
  };
  return loadScript(
    "https://telegram.org/js/telegram-widget.js?22",
    {
      "data-telegram-login": botUsername,
      "data-size": "large",
      "data-radius": "10",
      "data-onauth": "cadenceTelegramAuth(user)",
      "data-request-access": "write",
    },
    container,
  );
}
