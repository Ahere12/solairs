package app.solaris.client;

import org.lwjgl.sdl.SDLScancode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.resources.Identifier;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;

import app.solaris.client.hud.HudModule;
import app.solaris.client.hud.Modules;
import app.solaris.client.screen.SolarisMenuScreen;

/**
 * Solaris Client — Solaris's own in-game client: the Right Shift menu, a movable HUD
 * (FPS, CPS, keystrokes, coordinates, ping, clock), zoom and toggle sprint.
 */
public class SolarisClient implements ClientModInitializer {
	public static final String MOD_ID = "solaris";
	public static final Logger LOG = LoggerFactory.getLogger("Solaris Client");
	public static SolarisConfig CONFIG;

	private static KeyMapping menuKey, zoomKey;
	private static Integer fovBeforeZoom;
	private static boolean smoothBeforeZoom;

	@Override
	public void onInitializeClient() {
		CONFIG = SolarisConfig.load();
		KeyMapping.Category category = KeyMapping.Category.register(Identifier.fromNamespaceAndPath(MOD_ID, "solaris"));
		menuKey = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.solaris.menu", SDLScancode.SDL_SCANCODE_RSHIFT, category));
		zoomKey = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.solaris.zoom", SDLScancode.SDL_SCANCODE_C, category));

		HudElementRegistry.addLast(Identifier.fromNamespaceAndPath(MOD_ID, "hud"), SolarisClient::drawHud);
		ClientTickEvents.END_CLIENT_TICK.register(SolarisClient::tick);
		ClientLifecycleEvents.CLIENT_STARTED.register(client -> {
			applyFeatures();
			if (Boolean.getBoolean("solaris.selftest")) selfTestTicks = 0;
		});
		ClientLifecycleEvents.CLIENT_STOPPING.register(client -> endZoom(client));
		LOG.info("Solaris Client ready — press Right Shift in game");
	}

	private static void drawHud(GuiGraphicsExtractor g, net.minecraft.client.DeltaTracker delta) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.gui.hud.isHidden() || mc.player == null) return;
		Modules.Clicks.sample();
		if (mc.gui.screen() instanceof app.solaris.client.screen.HudEditorScreen) return; // the editor draws them itself
		int w = g.guiWidth(), h = g.guiHeight();
		for (HudModule m : Modules.HUD) {
			if (!m.enabled()) continue;
			m.draw(g, mc.font, m.x(w, mc.font), m.y(h, mc.font), false);
		}
	}

	// Self-test (only with -Dsolaris.selftest=true): opens the menu and the HUD editor and reports in the log.
	private static int selfTestTicks = -1;

	private static void selfTest(Minecraft mc) {
		if (selfTestTicks < 0) return;
		selfTestTicks++;
		if (selfTestTicks == 40) { mc.gui.setScreen(new SolarisMenuScreen(null)); LOG.info("SOLARIS_SELFTEST menu opened: {}", mc.gui.screen() instanceof SolarisMenuScreen); }
		if (selfTestTicks == 100) { mc.gui.setScreen(new app.solaris.client.screen.HudEditorScreen(null)); LOG.info("SOLARIS_SELFTEST hud editor opened: {}", mc.gui.screen() instanceof app.solaris.client.screen.HudEditorScreen); }
		if (selfTestTicks == 160) { mc.gui.setScreen(null); LOG.info("SOLARIS_SELFTEST done, config file saved: {}", net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir().resolve("solaris-client.json").toFile().exists()); selfTestTicks = -1; }
	}

	private static void tick(Minecraft mc) {
		selfTest(mc);
		while (menuKey.consumeClick()) {
			if (mc.gui.screen() == null) mc.gui.setScreen(new SolarisMenuScreen(null));
		}
		boolean zoomOn = CONFIG.isOn("zoom", true);
		if (zoomOn && zoomKey.isDown() && mc.gui.screen() == null) startZoom(mc);
		else endZoom(mc);
	}

	private static void startZoom(Minecraft mc) {
		if (fovBeforeZoom != null) return;
		fovBeforeZoom = mc.options.fov().get();
		smoothBeforeZoom = mc.options.smoothCamera;
		mc.options.fov().set(Math.max(30, Math.min(CONFIG.zoomFov, fovBeforeZoom)));
		mc.options.smoothCamera = true;
	}

	private static void endZoom(Minecraft mc) {
		if (fovBeforeZoom == null) return;
		mc.options.fov().set(fovBeforeZoom);
		mc.options.smoothCamera = smoothBeforeZoom;
		fovBeforeZoom = null;
	}

	/** Applies settings that map onto Minecraft options (toggle sprint). */
	public static void applyFeatures() {
		Minecraft mc = Minecraft.getInstance();
		if (mc.options == null) return;
		mc.options.toggleSprint().set(CONFIG.isOn("togglesprint", false));
	}
}
