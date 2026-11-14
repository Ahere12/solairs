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
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.minecraft.world.InteractionResult;

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
		// Reach and combo HUD: the local player hit something.
		AttackEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
			if (level.isClientSide() && player == Minecraft.getInstance().player) Modules.Tracker.hit(player.getEyePosition(), entity.getBoundingBox());
			return InteractionResult.PASS;
		});
		ClientLifecycleEvents.CLIENT_STARTED.register(client -> {
			applyFeatures();
			if (selftest("title")) selfTestTicks = 0;
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

	/** -Dsolaris.selftest=true runs both tests; =title or =world runs one. */
	private static boolean selftest(String which) {
		String v = System.getProperty("solaris.selftest", "");
		return v.equals("true") || v.equals(which);
	}

	private static int worldTestTicks = -1, waitTicks = 0;

	private static void selfTest(Minecraft mc) {
		// In a world: turn on every HUD piece and feature for a few seconds, then turn the features off again.
		if (selftest("world") && mc.player == null && ++waitTicks % 100 == 0) LOG.info("SOLARIS_SELFTEST waiting for a world, screen: {}", mc.gui.screen() == null ? "none" : mc.gui.screen().getClass().getName());
		if (selftest("world") && mc.player != null && worldTestTicks < 200) {
			worldTestTicks++;
			if (worldTestTicks == 20) {
				for (HudModule m : Modules.HUD) CONFIG.enabled.put(m.id, true);
				for (String f : new String[] {"togglesneak", "nohurtcam", "nobob", "bright"}) CONFIG.enabled.put(f, true);
				applyFeatures();
				LOG.info("SOLARIS_SELFTEST world: all {} HUD modules and features on (gamma={}, tilt={}, bob={})", Modules.HUD.size(), mc.options.gamma().get(), mc.options.damageTiltStrength().get(), mc.options.bobView().get());
			}
			if (worldTestTicks == 60) mc.gui.setScreen(new SolarisMenuScreen(null));
			if (worldTestTicks == 100) mc.gui.setScreen(new app.solaris.client.screen.HudEditorScreen(null));
			if (worldTestTicks == 140) { mc.gui.setScreen(null); copyCoordinates(); LOG.info("SOLARIS_SELFTEST clipboard: {}", mc.keyboardHandler.getClipboard()); }
			if (worldTestTicks == 180) {
				for (String f : new String[] {"togglesneak", "nohurtcam", "nobob", "bright"}) CONFIG.enabled.put(f, false);
				applyFeatures();
				LOG.info("SOLARIS_SELFTEST world done: restored gamma={}, tilt={}, bob={}", mc.options.gamma().get(), mc.options.damageTiltStrength().get(), mc.options.bobView().get());
			}
		}
		if (selfTestTicks < 0) return;
		selfTestTicks++;
		if (selfTestTicks == 40) { mc.gui.setScreen(new SolarisMenuScreen(null)); LOG.info("SOLARIS_SELFTEST menu opened: {}", mc.gui.screen() instanceof SolarisMenuScreen); }
		if (selfTestTicks == 100) { mc.gui.setScreen(new app.solaris.client.screen.HudEditorScreen(null)); LOG.info("SOLARIS_SELFTEST hud editor opened: {}", mc.gui.screen() instanceof app.solaris.client.screen.HudEditorScreen); }
		if (selfTestTicks == 160) { mc.gui.setScreen(null); LOG.info("SOLARIS_SELFTEST done, config file saved: {}", net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir().resolve("solaris-client.json").toFile().exists()); selfTestTicks = -1; }
	}

	private static void tick(Minecraft mc) {
		selfTest(mc);
		Modules.Tracker.tick(mc);
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

	/**
	 * Applies settings that map onto Minecraft options. Values the player had before turning a feature on are kept in
	 * the config, so turning it off gives them back.
	 */
	public static void applyFeatures() {
		Minecraft mc = Minecraft.getInstance();
		if (mc.options == null) return;
		var o = mc.options;
		o.toggleSprint().set(CONFIG.isOn("togglesprint", false));
		o.toggleCrouch().set(CONFIG.isOn("togglesneak", false));
		// No hurt camera: no screen tilt when you take damage
		if (CONFIG.isOn("nohurtcam", false)) { if (CONFIG.savedTilt == null) CONFIG.savedTilt = o.damageTiltStrength().get(); o.damageTiltStrength().set(0.0); }
		else if (CONFIG.savedTilt != null) { o.damageTiltStrength().set(CONFIG.savedTilt); CONFIG.savedTilt = null; }
		// No view bobbing
		if (CONFIG.isOn("nobob", false)) { if (CONFIG.savedBob == null) CONFIG.savedBob = o.bobView().get(); o.bobView().set(false); }
		else if (CONFIG.savedBob != null) { o.bobView().set(CONFIG.savedBob); CONFIG.savedBob = null; }
		// Max brightness (the brightest setting Minecraft allows)
		if (CONFIG.isOn("bright", false)) { if (CONFIG.savedGamma == null) CONFIG.savedGamma = o.gamma().get(); o.gamma().set(1.0); }
		else if (CONFIG.savedGamma != null) { o.gamma().set(CONFIG.savedGamma); CONFIG.savedGamma = null; }
		CONFIG.save();
	}

	/** Copies "x y z" to the clipboard and says so in chat. */
	public static void copyCoordinates() {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null) return;
		String c = (int) Math.floor(mc.player.getX()) + " " + (int) Math.floor(mc.player.getY()) + " " + (int) Math.floor(mc.player.getZ());
		mc.keyboardHandler.setClipboard(c);
		mc.player.sendSystemMessage(net.minecraft.network.chat.Component.literal("§6[Solaris]§r Copied coordinates: " + c));
	}
}
