package app.solaris.client;

import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import net.fabricmc.loader.api.FabricLoader;

/** Solaris Client settings, saved to config/solaris-client.json. */
public final class SolarisConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("solaris-client.json");

	/** Module id -> enabled. */
	public Map<String, Boolean> enabled = new LinkedHashMap<>();
	/** HUD element id -> position (fraction of screen size, so it survives window resizes). */
	public Map<String, float[]> positions = new LinkedHashMap<>();
	/** HUD text colour (ARGB). */
	public int textColor = 0xFFFFFFFF;
	/** Accent colour (ARGB), used for highlights and pressed keys. */
	public int accentColor = 0xFFFF9F1C;
	public boolean textShadow = true;
	public boolean hudBackground = true;
	/** Zoom field of view (30 = strongest Minecraft allows). */
	public int zoomFov = 30;
	/** The player's own values before a Solaris feature changed them (null = not changed). */
	public Double savedTilt, savedGamma;
	public Boolean savedBob;

	public boolean isOn(String id, boolean def) {
		return enabled.getOrDefault(id, def);
	}

	public void set(String id, boolean on) {
		enabled.put(id, on);
		save();
	}

	public float[] pos(String id, float defX, float defY) {
		return positions.computeIfAbsent(id, k -> new float[] {defX, defY});
	}

	public static SolarisConfig load() {
		try {
			if (Files.exists(FILE)) {
				try (Reader r = Files.newBufferedReader(FILE)) {
					SolarisConfig c = GSON.fromJson(r, SolarisConfig.class);
					if (c != null) {
						if (c.enabled == null) c.enabled = new LinkedHashMap<>();
						if (c.positions == null) c.positions = new LinkedHashMap<>();
						return c;
					}
				}
			}
		} catch (Exception e) {
			SolarisClient.LOG.warn("Could not read Solaris settings, using defaults", e);
		}
		return new SolarisConfig();
	}

	public void save() {
		try {
			Files.createDirectories(FILE.getParent());
			try (Writer w = Files.newBufferedWriter(FILE)) {
				GSON.toJson(this, w);
			}
		} catch (Exception e) {
			SolarisClient.LOG.warn("Could not save Solaris settings", e);
		}
	}
}
