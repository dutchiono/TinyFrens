import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();
app.use("*", cors());

function getSnapPayload(action?: string) {
  const effects = action && ["pet", "feed", "play"].includes(action) ? ["confetti"] : [];
  let statusText = "Your 1:1 on-chain & floating desktop companion.";
  if (action === "pet") statusText = "You petted the fren! They did a little wiggle 💖";
  else if (action === "feed") statusText = "You fed the fren a fresh strawberry 🍓! Nom nom.";
  else if (action === "play") statusText = "You played ball with your fren 🎾! Joy is at 100%!";

  const baseUrl = process.env.SNAP_PUBLIC_BASE_URL || "https://tinyfrens.lol";

  return {
    version: "2.0",
    theme: { accent: "purple" },
    effects,
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: { gap: "md" },
          children: ["header", "hero-img", "status-text", "action-buttons", "open-miniapp-btn"]
        },
        header: {
          type: "text",
          props: {
            content: "TinyFrens · Pocket Pet",
            weight: "bold",
            size: "lg"
          }
        },
        "hero-img": {
          type: "image",
          props: {
            url: "https://tinyfrens.lol/icons/icon-512.png",
            aspect: "16:9",
            title: "TinyFrens",
            subtitle: statusText
          }
        },
        "status-text": {
          type: "text",
          props: {
            content: "Interactive companion · Curated on-chain supply · In-feed pet care · Multiplayer party rooms",
            size: "sm"
          }
        },
        "action-buttons": {
          type: "stack",
          props: {
            direction: "horizontal",
            gap: "sm",
            equalWidth: true
          },
          children: ["btn-pet", "btn-feed", "btn-play"]
        },
        "btn-pet": {
          type: "button",
          props: { label: "Pet 💖", variant: "secondary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${baseUrl}/api/snap/interact?action=pet` }
            }
          }
        },
        "btn-feed": {
          type: "button",
          props: { label: "Feed 🍓", variant: "secondary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${baseUrl}/api/snap/interact?action=feed` }
            }
          }
        },
        "btn-play": {
          type: "button",
          props: { label: "Play 🎾", variant: "secondary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${baseUrl}/api/snap/interact?action=play` }
            }
          }
        },
        "open-miniapp-btn": {
          type: "button",
          props: {
            label: "Open TinyFrens Mini App 🐾",
            variant: "primary",
            icon: "arrow-right"
          },
          on: {
            press: {
              action: "open_mini_app",
              params: { target: "https://tinyfrens.lol/" }
            }
          }
        }
      }
    }
  };
}

app.get("/", (c) => {
  return c.json(getSnapPayload(), 200, {
    "Content-Type": "application/vnd.farcaster.snap+json"
  });
});

app.post("/", async (c) => {
  const url = new URL(c.req.url);
  const action = url.searchParams.get("action") || undefined;
  return c.json(getSnapPayload(action), 200, {
    "Content-Type": "application/vnd.farcaster.snap+json"
  });
});

export default app;
