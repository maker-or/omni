import type { Project } from "../../contracts/projects.ts";
import type { Thread } from "../../contracts/threads.ts";
import type { Message } from "../../contracts/messages.ts";

export interface CreateProjectInput {
  name: string;
  path: string;
  icon: string;
}

export {};

declare global {
  interface Window {
    omni: {
      launch: {
        complete: (projectId: string) => Promise<void>;
        show: () => Promise<void>;
      };
      projects: {
        list: () => Promise<Project[]>;
        create: (input: CreateProjectInput) => Promise<Project>;
        getActive: () => Promise<Project | null>;
        setActive: (projectId: string) => Promise<void>;
      };
      threads: {
        list: () => Promise<Thread[]>;
        create: (projectId: string, title: string) => Promise<Thread>;
        delete: (id: string) => Promise<void>;
      };
      messages: {
        list: (threadId: string) => Promise<Message[]>;
        create: (input: { thread_id: string; role: string; content: string }) => Promise<Message>;
      };
      dialog: {
        pickDirectory: () => Promise<string | null>;
      };
    };
  }
}
