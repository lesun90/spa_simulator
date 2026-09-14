import type { PhysicsEngineFactory, PhysicsWorld } from "./PhysicsWorld";

export class PhysicsEngineRegistry {
  private readonly factories = new Map<string, PhysicsEngineFactory>();

  register(factory: PhysicsEngineFactory): void {
    if (!factory.key.trim()) throw new Error("Physics engine key is required.");
    if (this.factories.has(factory.key)) throw new Error(`Physics engine ${factory.key} is already registered.`);
    this.factories.set(factory.key, factory);
  }

  choices(): readonly { key: string; label: string }[] {
    return Object.freeze([...this.factories.values()].map(({ key, label }) => ({ key, label })));
  }

  async create(key: string): Promise<PhysicsWorld> {
    const factory = this.factories.get(key);
    if (!factory) throw new Error(`Physics engine ${key} is not registered.`);
    return factory.create();
  }
}
