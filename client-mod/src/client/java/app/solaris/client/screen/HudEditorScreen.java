package app.solaris.client.screen;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

import app.solaris.client.SolarisClient;
import app.solaris.client.hud.HudModule;
import app.solaris.client.hud.Modules;

/** Drag HUD modules around the screen. */
public class HudEditorScreen extends Screen {
	private final Screen parent;
	private HudModule dragging;
	private int grabX, grabY;

	public HudEditorScreen(Screen parent) {
		super(Component.literal("Edit HUD layout"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		this.addRenderableWidget(Button.builder(Component.literal("Reset layout"), b -> {
			SolarisClient.CONFIG.positions.clear();
			SolarisClient.CONFIG.save();
		}).pos(this.width / 2 - 155, this.height - 28).size(150, 20).build());
		this.addRenderableWidget(Button.builder(Component.literal("Done"), b -> this.onClose())
				.pos(this.width / 2 + 5, this.height - 28).size(150, 20).build());
	}

	/** No blur in the editor: you need to see the game behind the HUD. */
	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		g.fill(0, 0, this.width, this.height, 0x55000000);
		g.centeredText(this.font, "Drag the HUD pieces where you want them", this.width / 2, 10, 0xFFFFFFFF);
		for (HudModule m : Modules.HUD) {
			if (!m.enabled()) continue;
			int x = m.x(this.width, this.font), y = m.y(this.height, this.font);
			int w = m.width(this.font), h = m.height(this.font);
			boolean hot = m == dragging || (mouseX >= x && mouseX < x + w && mouseY >= y && mouseY < y + h);
			g.fill(x - 1, y - 1, x + w + 1, y + h + 1, hot ? SolarisClient.CONFIG.accentColor : 0x88FFFFFF);
			g.fill(x, y, x + w, y + h, 0xAA101010);
			m.draw(g, this.font, x, y, true);
		}
		super.extractRenderState(g, mouseX, mouseY, delta);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (super.mouseClicked(event, doubleClick)) return true;
		double mx = event.x(), my = event.y();
		for (HudModule m : Modules.HUD) {
			if (!m.enabled()) continue;
			int x = m.x(this.width, this.font), y = m.y(this.height, this.font);
			if (mx >= x && mx < x + m.width(this.font) && my >= y && my < y + m.height(this.font)) {
				dragging = m;
				grabX = (int) mx - x;
				grabY = (int) my - y;
				return true;
			}
		}
		return false;
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent event, double dx, double dy) {
		if (dragging != null) {
			dragging.moveTo((int) event.x() - grabX, (int) event.y() - grabY, this.width, this.height);
			return true;
		}
		return super.mouseDragged(event, dx, dy);
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		if (dragging != null) {
			dragging = null;
			SolarisClient.CONFIG.save();
			return true;
		}
		return super.mouseReleased(event);
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
