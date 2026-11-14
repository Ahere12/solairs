package app.solaris.client.hud;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

import java.util.ArrayList;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffectUtil;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

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

	public static final HudModule SPEED = new TextModule("speed", "Speed", false, 1.0f, 0.03f) {
		@Override
		String text(boolean preview) {
			return String.format("%.1f m/s", Tracker.speed);
		}
	};

	public static final HudModule REACH = new TextModule("reach", "Reach", false, 1.0f, 0.08f) {
		@Override
		String text(boolean preview) {
			boolean fresh = System.currentTimeMillis() - Tracker.reachAt < 3000;
			return fresh ? String.format("%.2f blocks", Tracker.reach) : "Reach -";
		}
	};

	public static final HudModule COMBO = new TextModule("combo", "Combo", false, 1.0f, 0.13f) {
		@Override
		String text(boolean preview) {
			return Tracker.combo == 0 ? "No combo" : Tracker.combo + " combo";
		}
	};

	public static final HudModule DAY = new TextModule("day", "Day counter", false, 1.0f, 0.18f) {
		@Override
		String text(boolean preview) {
			if (mc().level == null) return "Day 1";
			return "Day " + (mc().level.getOverworldClockTime() / 24000L + 1);
		}
	};

	public static final HudModule MEMORY = new TextModule("memory", "Memory", false, 1.0f, 0.23f) {
		@Override
		String text(boolean preview) {
			Runtime r = Runtime.getRuntime();
			long used = r.totalMemory() - r.freeMemory();
			return String.format("Mem %d%% %.1f/%.1f GB", (int) (used * 100 / r.maxMemory()), used / 1073741824.0, r.maxMemory() / 1073741824.0);
		}
	};

	public static final HudModule SERVER = new TextModule("server", "Server address", false, 1.0f, 0.28f) {
		@Override
		String text(boolean preview) {
			ServerData d = mc().getCurrentServer();
			if (d != null) return d.ip;
			return mc().hasSingleplayerServer() ? "Singleplayer" : "Main menu";
		}
	};

	/** Armor and held item with durability, top to bottom. */
	public static final HudModule ARMOR = new HudModule("armor", "Armor status", false, 1.0f, 0.35f) {
		final EquipmentSlot[] slots = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET, EquipmentSlot.MAINHAND};

		private List<ItemStack> items() {
			List<ItemStack> out = new ArrayList<>();
			LocalPlayer p = mc().player;
			if (p != null) for (EquipmentSlot s : slots) { ItemStack st = p.getItemBySlot(s); if (!st.isEmpty()) out.add(st); }
			return out;
		}

		@Override
		public int width(Font font) {
			return 18 + 4 + font.width("0000");
		}

		@Override
		public int height(Font font) {
			return Math.max(1, items().size()) * 17;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, Font font, int x, int y, boolean preview) {
			List<ItemStack> list = items();
			if (list.isEmpty()) { if (preview) label(g, font, "No armor", x, y); return; }
			int i = 0;
			for (ItemStack st : list) {
				int yy = y + i * 17;
				g.item(st, x, yy);
				String t = st.isDamageableItem() ? String.valueOf(st.getMaxDamage() - st.getDamageValue()) : (st.getCount() > 1 ? String.valueOf(st.getCount()) : "");
				if (!t.isEmpty()) {
					int color = SolarisClient.CONFIG.textColor;
					if (st.isDamageableItem()) {
						float left = 1f - (float) st.getDamageValue() / Math.max(1, st.getMaxDamage());
						color = left > 0.5f ? 0xFF55FF55 : left > 0.2f ? 0xFFFFFF55 : 0xFFFF5555;
					}
					g.text(font, t, x + 20, yy + 5, color, SolarisClient.CONFIG.textShadow);
				}
				i++;
			}
		}
	};

	/** Active potion effects with the time left. */
	public static final HudModule EFFECTS = new HudModule("effects", "Potion effects", false, 1.0f, 0.70f) {
		private List<String> lines() {
			List<String> out = new ArrayList<>();
			LocalPlayer p = mc().player;
			if (p == null) return out;
			for (MobEffectInstance e : p.getActiveEffects()) {
				String name = e.getEffect().value().getDisplayName().getString();
				String lvl = e.getAmplifier() > 0 ? " " + roman(e.getAmplifier() + 1) : "";
				out.add(name + lvl + "  " + MobEffectUtil.formatDuration(e, 1f, 20f).getString());
			}
			return out;
		}

		@Override
		public int width(Font font) {
			int w = font.width("Speed II  0:00");
			for (String l : lines()) w = Math.max(w, font.width(l));
			return w + 6;
		}

		@Override
		public int height(Font font) {
			return Math.max(1, lines().size()) * (font.lineHeight + 4);
		}

		@Override
		public void draw(GuiGraphicsExtractor g, Font font, int x, int y, boolean preview) {
			List<String> ls = lines();
			if (ls.isEmpty()) { if (preview) label(g, font, "Speed II  1:30", x, y); return; }
			for (int i = 0; i < ls.size(); i++) label(g, font, ls.get(i), x, y + i * (font.lineHeight + 4));
		}
	};

	public static final List<HudModule> HUD = List.of(FPS, CPS, COORDS, PING, CLOCK, KEYSTROKES, ARMOR, EFFECTS, SPEED, REACH, COMBO, DAY, MEMORY, SERVER);

	static String roman(int n) {
		String[] r = {"", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"};
		return n < r.length ? r[n] : String.valueOf(n);
	}

	/** Per-tick measurements: speed, reach of the last hit, combo. */
	public static final class Tracker {
		static double speed;
		static double reach;
		static long reachAt;
		static int combo;
		private static long lastHit;
		private static Vec3 last;

		public static void tick(Minecraft mc) {
			LocalPlayer p = mc.player;
			if (p == null) { last = null; combo = 0; speed = 0; return; }
			Vec3 now = p.position();
			if (last != null) {
				double dx = now.x - last.x, dz = now.z - last.z;
				double s = Math.sqrt(dx * dx + dz * dz) * 20; // blocks per tick -> per second
				speed = speed * 0.6 + s * 0.4;
			}
			last = now;
			// a combo ends when you get hit, or after 2 s without landing one
			if (p.hurtTime > 0 || System.currentTimeMillis() - lastHit > 2000) combo = 0;
		}

		/** Called when the local player hits an entity: distance from the eyes to the nearest point of its hitbox. */
		public static void hit(Vec3 eye, AABB box) {
			Vec3 nearest = new Vec3(Math.max(box.minX, Math.min(eye.x, box.maxX)), Math.max(box.minY, Math.min(eye.y, box.maxY)), Math.max(box.minZ, Math.min(eye.z, box.maxZ)));
			reach = eye.distanceTo(nearest);
			reachAt = System.currentTimeMillis();
			combo++;
			lastHit = reachAt;
		}
	}

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
