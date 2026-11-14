package app.solaris.client.screen;

import java.util.ArrayList;
import java.util.List;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import app.solaris.client.SolarisClient;
import app.solaris.client.hud.HudModule;
import app.solaris.client.hud.Modules;

/** The Solaris menu (Right Shift): every Solaris feature in one place, in three sections. */
public class SolarisMenuScreen extends Screen {
	private record Toggle(String id, String name, boolean def) {}

	private static final List<Toggle> FEATURES = List.of(
			new Toggle("togglesprint", "Toggle Sprint", false),
			new Toggle("togglesneak", "Toggle Sneak", false),
			new Toggle("zoom", "Zoom (hold C)", true),
			new Toggle("nohurtcam", "No hurt camera", false),
			new Toggle("nobob", "No view bobbing", false),
			new Toggle("bright", "Max brightness", false),
			new Toggle("hudbg", "HUD background", true),
			new Toggle("shadow", "Text shadow", true));

	/** Colour choices for the accent and the HUD text. */
	private static final int[] COLORS = {0xFFFF9F1C, 0xFFFFFFFF, 0xFF55FFFF, 0xFF55FF55, 0xFFFF5555, 0xFFFF55FF, 0xFFFFFF55, 0xFF5599FF};
	private static final String[] COLOR_NAMES = {"Solar orange", "White", "Aqua", "Green", "Red", "Pink", "Yellow", "Blue"};

	private final Screen parent;
	private final List<int[]> headings = new ArrayList<>(); // {y} of each section title
	private static final String[] SECTIONS = {"HUD", "Features", "Style"};

	public SolarisMenuScreen(Screen parent) {
		super(Component.literal("Solaris Client"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		headings.clear();
		int gap = 4, bh = 18;
		int cols = Math.max(2, Math.min(4, (this.width - 20) / (124 + gap)));
		int bw = Math.min(150, (this.width - 20 - (cols - 1) * gap) / cols);
		int totalW = cols * bw + (cols - 1) * gap;
		int x0 = (this.width - totalW) / 2;
		int y = 48;

		// HUD
		headings.add(new int[] {y});
		y += 12;
		y = grid(new ArrayList<Object>(Modules.HUD), x0, y, cols, bw, bh, gap) + 6;
		// Features
		headings.add(new int[] {y});
		y += 12;
		y = grid(new ArrayList<Object>(FEATURES), x0, y, cols, bw, bh, gap) + 6;
		// Style
		headings.add(new int[] {y});
		y += 12;
		this.addRenderableWidget(Button.builder(colorLabel("Accent", SolarisClient.CONFIG.accentColor), b -> {
			SolarisClient.CONFIG.accentColor = next(SolarisClient.CONFIG.accentColor);
			SolarisClient.CONFIG.save();
			b.setMessage(colorLabel("Accent", SolarisClient.CONFIG.accentColor));
		}).pos(x0, y).size(bw, bh).build());
		this.addRenderableWidget(Button.builder(colorLabel("Text", SolarisClient.CONFIG.textColor), b -> {
			SolarisClient.CONFIG.textColor = next(SolarisClient.CONFIG.textColor);
			SolarisClient.CONFIG.save();
			b.setMessage(colorLabel("Text", SolarisClient.CONFIG.textColor));
		}).pos(x0 + bw + gap, y).size(bw, bh).build());
		y += bh + 12;

		int w3 = Math.min(150, (this.width - 20 - 2 * gap) / 3);
		int bx = (this.width - (w3 * 3 + gap * 2)) / 2;
		int by = Math.min(y, this.height - 26);
		this.addRenderableWidget(Button.builder(Component.literal("Edit HUD layout"), b -> this.minecraft.gui.setScreen(new HudEditorScreen(this)))
				.pos(bx, by).size(w3, 20).build());
		this.addRenderableWidget(Button.builder(Component.literal("Copy coordinates"), b -> { SolarisClient.copyCoordinates(); this.onClose(); })
				.pos(bx + w3 + gap, by).size(w3, 20).build());
		this.addRenderableWidget(Button.builder(Component.literal("Done"), b -> this.onClose())
				.pos(bx + (w3 + gap) * 2, by).size(w3, 20).build());
	}

	/** Adds one toggle button per item; returns the y below the grid. */
	private int grid(List<Object> items, int x0, int y0, int cols, int bw, int bh, int gap) {
		for (int i = 0; i < items.size(); i++) {
			Object o = items.get(i);
			int x = x0 + (i % cols) * (bw + gap), y = y0 + (i / cols) * (bh + gap);
			this.addRenderableWidget(Button.builder(label(o), b -> {
				flip(o);
				b.setMessage(label(o));
			}).pos(x, y).size(bw, bh).build());
		}
		int rows = (items.size() + cols - 1) / cols;
		return y0 + rows * (bh + gap);
	}

	private static int next(int color) {
		for (int i = 0; i < COLORS.length; i++) if (COLORS[i] == color) return COLORS[(i + 1) % COLORS.length];
		return COLORS[0];
	}

	private static Component colorLabel(String what, int color) {
		String name = "Custom";
		for (int i = 0; i < COLORS.length; i++) if (COLORS[i] == color) name = COLOR_NAMES[i];
		return Component.literal(what + ": " + name);
	}

	private static boolean isOn(Object o) {
		if (o instanceof HudModule m) return m.enabled();
		Toggle t = (Toggle) o;
		if (t.id().equals("hudbg")) return SolarisClient.CONFIG.hudBackground;
		if (t.id().equals("shadow")) return SolarisClient.CONFIG.textShadow;
		return SolarisClient.CONFIG.isOn(t.id(), t.def());
	}

	private static void flip(Object o) {
		boolean next = !isOn(o);
		if (o instanceof HudModule m) { SolarisClient.CONFIG.set(m.id, next); return; }
		Toggle t = (Toggle) o;
		if (t.id().equals("hudbg")) SolarisClient.CONFIG.hudBackground = next;
		else if (t.id().equals("shadow")) SolarisClient.CONFIG.textShadow = next;
		else SolarisClient.CONFIG.enabled.put(t.id(), next);
		SolarisClient.applyFeatures(); // also saves
	}

	private static Component label(Object o) {
		String name = o instanceof HudModule m ? m.name : ((Toggle) o).name();
		return Component.literal(name + ": " + (isOn(o) ? "§aON" : "§7OFF"));
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		// super draws the (blurred) background and the buttons — the background may only be drawn once per frame
		super.extractRenderState(g, mouseX, mouseY, delta);
		int accent = SolarisClient.CONFIG.accentColor;
		g.centeredText(this.font, "SOLARIS", this.width / 2, 12, accent);
		g.fill(this.width / 2 - 70, 23, this.width / 2 + 70, 24, accent);
		g.centeredText(this.font, "Client menu · Right Shift", this.width / 2, 30, 0xFFAAAAAA);
		for (int i = 0; i < headings.size() && i < SECTIONS.length; i++) g.text(this.font, SECTIONS[i], (this.width - this.font.width(SECTIONS[i])) / 2, headings.get(i)[0], 0xFFFFFFFF, true);
	}

	@Override
	public void onClose() {
		SolarisClient.CONFIG.save();
		this.minecraft.gui.setScreen(this.parent);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}
}
