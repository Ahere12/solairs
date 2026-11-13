package app.solaris.client.hud;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.LocalPlayer;

import app.solaris.client.SolarisClient;

/** All Solaris HUD modules. */
public final class Modules {
	private Modules() {}

	public static final HudModule FPS = new TextModule("fps", "FPS", true, 0.005f, 0.01f) {
		@Override
		String text(boolean preview) {
			return mc().getFps() + " FPS";
		}
	};

	public static final HudModule CPS = new TextModule("cps", "CPS", true, 0.005f, 0.06f) {
		@Override
		String text(boolean preview) {
			return Clicks.left() + " | " + Clicks.right() + " CPS";
		}
	};

	public static final HudModule COORDS = new TextModule("coords", "Coordinates", true, 0.005f, 0.11f) {
		@Override
		String text(boolean preview) {
			LocalPlayer p = mc().player;
			if (p == null) return "XYZ 0 64 0  N";
			return String.format("XYZ %d %d %d  %s", (int) Math.floor(p.getX()), (int) Math.floor(p.getY()), (int) Math.floor(p.getZ()), facing(p.getYRot()));
		}
	};

	public static final HudModule PING = new TextModule("ping", "Ping", false, 0.005f, 0.16f) {
		@Override
		String text(boolean preview) {
			LocalPlayer p = mc().player;
			if (p == null || mc().getConnection() == null) return "0 ms";
			PlayerInfo info = mc().getConnection().getPlayerInfo(p.getUUID());
			return (info == null ? 0 : info.getLatency()) + " ms";
		}
	};

	public static final HudModule CLOCK = new TextModule("clock", "Clock", false, 0.005f, 0.21f) {
		private final DateTimeFormatter f = DateTimeFormatter.ofPattern("HH:mm");

		@Override
		String text(boolean preview) {
			return LocalTime.now().format(f);
		}
	};

	public static final HudModule KEYSTROKES = new HudModule("keystrokes", "Keystrokes", true, 0.005f, 0.30f) {
		static final int K = 22, GAP = 2;

		@Override
		public int width(Font font) {
			return K * 3 + GAP * 2;
		}

		@Override
		public int height(Font font) {
			return K * 3 + GAP * 2 + 14;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, Font font, int x, int y, boolean preview) {
			var o = mc().options;
			key(g, font, x + K + GAP, y, K, K, "W", o.keyUp);
			key(g, font, x, y + K + GAP, K, K, "A", o.keyLeft);
			key(g, font, x + K + GAP, y + K + GAP, K, K, "S", o.keyDown);
			key(g, font, x + (K + GAP) * 2, y + K + GAP, K, K, "D", o.keyRight);
			int half = (width(font) - GAP) / 2;
			key(g, font, x, y + (K + GAP) * 2, half, K, "LMB " + Clicks.left(), o.keyAttack);
			key(g, font, x + half + GAP, y + (K + GAP) * 2, half, K, "RMB " + Clicks.right(), o.keyUse);
			key(g, font, x, y + (K + GAP) * 3, width(font), 12, "———", o.keyJump);
		}

		private void key(GuiGraphicsExtractor g, Font font, int x, int y, int w, int h, String label, KeyMapping km) {
			boolean down = km.isDown();
			g.fill(x, y, x + w, y + h, down ? (SolarisClient.CONFIG.accentColor & 0x00FFFFFF) | 0xCC000000 : 0x66000000);
			int tw = font.width(label);
			g.text(font, label, x + (w - tw) / 2, y + (h - font.lineHeight) / 2 + 1, down ? 0xFF000000 : SolarisClient.CONFIG.textColor, !down && SolarisClient.CONFIG.textShadow);
		}
	};

	public static final List<HudModule> HUD = List.of(FPS, CPS, COORDS, PING, CLOCK, KEYSTROKES);

	/** Compass direction for a yaw angle. */
	static String facing(float yaw) {
		String[] dirs = {"S", "SW", "W", "NW", "N", "NE", "E", "SE"};
		int i = Math.floorMod(Math.round(yaw / 45f), 8);
		return dirs[i];
	}

	/** A module that is one line of text. */
	abstract static class TextModule extends HudModule {
		TextModule(String id, String name, boolean on, float x, float y) {
			super(id, name, on, x, y);
		}

		abstract String text(boolean preview);

		@Override
		public int width(Font font) {
			return labelWidth(font, text(true));
		}

		@Override
		public int height(Font font) {
			return labelHeight(font);
		}

		@Override
		public void draw(GuiGraphicsExtractor g, Font font, int x, int y, boolean preview) {
			label(g, font, text(preview), x, y);
		}
	}

	/** Clicks-per-second: press transitions of the attack/use keys, sampled every frame. */
	public static final class Clicks {
		private static final Deque<Long> LEFT = new ArrayDeque<>(), RIGHT = new ArrayDeque<>();
		private static boolean wasLeft, wasRight;

		public static void sample() {
			var o = net.minecraft.client.Minecraft.getInstance().options;
			long now = System.currentTimeMillis();
			boolean l = o.keyAttack.isDown(), r = o.keyUse.isDown();
			if (l && !wasLeft) LEFT.add(now);
			if (r && !wasRight) RIGHT.add(now);
			wasLeft = l;
			wasRight = r;
			while (!LEFT.isEmpty() && now - LEFT.peekFirst() > 1000) LEFT.pollFirst();
			while (!RIGHT.isEmpty() && now - RIGHT.peekFirst() > 1000) RIGHT.pollFirst();
		}

		public static int left() {
			return LEFT.size();
		}

		public static int right() {
			return RIGHT.size();
		}
	}
}
