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

/** The Solaris menu (Right Shift): every Solaris feature in one place. */
public class SolarisMenuScreen extends Screen {
	private record Toggle(String id, String name, String hint, boolean def) {}

	private static final List<Toggle> FEATURES = List.of(
			new Toggle("togglesprint", "Toggle Sprint", "Sprint stays on — no need to hold the key", false),
			new Toggle("zoom", "Zoom", "Hold C to zoom in", true),
			new Toggle("hudbg", "HUD background", "Dark box behind HUD text", true));

	private final Screen parent;

	public SolarisMenuScreen(Screen parent) {
		super(Component.literal("Solaris Client"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		List<Object> all = new ArrayList<>();
		all.addAll(Modules.HUD);
		all.addAll(FEATURES);
		int cols = 3, bw = 150, bh = 20, gap = 6;
		int totalW = cols * bw + (cols - 1) * gap;
		int x0 = (this.width - totalW) / 2, y0 = 70;
		for (int i = 0; i < all.size(); i++) {
			Object o = all.get(i);
			int x = x0 + (i % cols) * (bw + gap), y = y0 + (i / cols) * (bh + gap);
			this.addRenderableWidget(Button.builder(label(o), b -> {
				flip(o);
				b.setMessage(label(o));
			}).pos(x, y).size(bw, bh).build());
		}
		int rows = (all.size() + cols - 1) / cols;
		int by = y0 + rows * (bh + gap) + 14;
		this.addRenderableWidget(Button.builder(Component.literal("Edit HUD layout"), b -> this.minecraft.gui.setScreen(new HudEditorScreen(this)))
				.pos(this.width / 2 - 155, by).size(150, 20).build());
		this.addRenderableWidget(Button.builder(Component.literal("Done"), b -> this.onClose())
				.pos(this.width / 2 + 5, by).size(150, 20).build());
	}

	private static boolean isOn(Object o) {
		if (o instanceof HudModule m) return m.enabled();
		Toggle t = (Toggle) o;
		if (t.id().equals("hudbg")) return SolarisClient.CONFIG.hudBackground;
		return SolarisClient.CONFIG.isOn(t.id(), t.def());
	}

	private static void flip(Object o) {
		boolean next = !isOn(o);
		if (o instanceof HudModule m) SolarisClient.CONFIG.set(m.id, next);
		else {
			Toggle t = (Toggle) o;
			if (t.id().equals("hudbg")) {
				SolarisClient.CONFIG.hudBackground = next;
				SolarisClient.CONFIG.save();
			} else SolarisClient.CONFIG.set(t.id(), next);
			SolarisClient.applyFeatures();
		}
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
		g.fill(this.width / 2 - 70, 26, this.width / 2 + 70, 27, accent);
		g.centeredText(this.font, "SOLARIS", this.width / 2, 14, accent);
		g.centeredText(this.font, "Client menu · press Right Shift any time", this.width / 2, 34, 0xFFAAAAAA);
		g.centeredText(this.font, "HUD", this.width / 2, 56, 0xFFFFFFFF);
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
