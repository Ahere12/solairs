package app.solaris.client.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import app.solaris.client.SolarisClient;

/** A movable piece of the Solaris HUD. Positions are stored as fractions of the screen. */
public abstract class HudModule {
	public final String id;
	public final String name;
	public final boolean defaultOn;
	final float defX, defY;

	protected HudModule(String id, String name, boolean defaultOn, float defX, float defY) {
		this.id = id;
		this.name = name;
		this.defaultOn = defaultOn;
		this.defX = defX;
		this.defY = defY;
	}

	public boolean enabled() {
		return SolarisClient.CONFIG.isOn(id, defaultOn);
	}

	/** Width and height in GUI pixels for the current content. */
	public abstract int width(Font font);

	public abstract int height(Font font);

	/** Draws the module with its top-left corner at x, y. `preview` is true in the HUD editor. */
	public abstract void draw(GuiGraphicsExtractor g, Font font, int x, int y, boolean preview);

	public int x(int screenW, Font font) {
		float[] p = SolarisClient.CONFIG.pos(id, defX, defY);
		return clamp(Math.round(p[0] * screenW), 0, Math.max(0, screenW - width(font)));
	}

	public int y(int screenH, Font font) {
		float[] p = SolarisClient.CONFIG.pos(id, defX, defY);
		return clamp(Math.round(p[1] * screenH), 0, Math.max(0, screenH - height(font)));
	}

	public void moveTo(int x, int y, int screenW, int screenH) {
		float[] p = SolarisClient.CONFIG.pos(id, defX, defY);
		p[0] = screenW == 0 ? 0 : (float) x / screenW;
		p[1] = screenH == 0 ? 0 : (float) y / screenH;
	}

	static int clamp(int v, int lo, int hi) {
		return Math.max(lo, Math.min(hi, v));
	}

	/** A text line on an optional translucent background. */
	protected static void label(GuiGraphicsExtractor g, Font font, String text, int x, int y) {
		if (SolarisClient.CONFIG.hudBackground) g.fill(x, y, x + font.width(text) + 6, y + font.lineHeight + 4, 0x66000000);
		g.text(font, text, x + 3, y + 3, SolarisClient.CONFIG.textColor, SolarisClient.CONFIG.textShadow);
	}

	protected static int labelWidth(Font font, String text) {
		return font.width(text) + 6;
	}

	protected static int labelHeight(Font font) {
		return font.lineHeight + 4;
	}

	protected static Minecraft mc() {
		return Minecraft.getInstance();
	}
}
