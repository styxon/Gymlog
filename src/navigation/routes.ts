export type RootTabKey = 'home' | 'workout' | 'progress' | 'profile';

export type AppRoute =
  | {
      tab: 'home';
      screen: 'dashboard';
    }
  | {
      /** The middle AI button. Always the chat — never a paywall. */
      tab: 'home';
      screen: 'ai_chat';
      /**
       * A question the app is asking on the reader's behalf, carried in from a
       * coach demo moment. Present only on the hop out of the completion
       * screen; the chat clears it as it sends.
       */
      demoQuestion?: string;
      /** Which moment it is, so the chat can spend it when it truly sends. */
      demoMomentKey?: string;
      /**
       * Opened from the new-programme sheet's AI option: the chat asks the
       * frame of the week before anything else. Cleared once taken, like the
       * demo question, so a remount or Back cannot start it again.
       */
      intent?: 'new_program';
    }
  | {
      tab: 'home';
      screen: 'history';
    }
  | {
      tab: 'home';
      screen: 'cardio';
    }
  | {
      tab: 'home';
      screen: 'session';
      sessionId: string;
    }
  | {
      /** The coach's written-out analysis of one logged session. */
      tab: 'home';
      screen: 'analysis';
      sessionId: string;
    }
  | {
      tab: 'workout';
      screen: 'programs_home';
    }
  | {
      /**
       * A season as a screen, not a filter: dates, week N of 26, the reader's
       * own points and the programs that belong to it.
       */
      tab: 'workout';
      screen: 'season';
      season: 'winter' | 'summer';
    }
  | {
      /**
       * Setting a target, in three steps: which lift, how much heavier, and
       * the week that would be built for it.
       *
       * Its own screen rather than a sheet, because "what am I aiming at" is a
       * decision, and a decision that arrives as a drawer over the thing you
       * were reading gets dismissed. It replaced a page of ready-made numbers
       * — five lifts at three round figures each — because a round figure is
       * not a target: 100 kg means one thing to someone benching 95 and
       * another to someone benching 60.
       */
      tab: 'workout';
      screen: 'goalFlow';
    }
  | {
      /**
       * Every ready programme, narrowed by level, goal and free text.
       *
       * The goal discs on the tab are a taxonomy — nine doors onto fixed
       * slices — so "a four-day muscle programme I can start as a beginner"
       * had nowhere to be asked. Reached from the new-programme sheet.
       */
      tab: 'workout';
      screen: 'catalog';
    }
  | {
      tab: 'workout';
      screen: 'list';
    }
  | {
      tab: 'workout';
      screen: 'plans';
    }
  | {
      tab: 'workout';
      screen: 'detail';
      exerciseId: string;
    }
  | {
      tab: 'workout';
      screen: 'program';
      programType: 'ready' | 'custom';
      workoutTemplateId: string;
    }
  | {
      tab: 'workout';
      screen: 'programDay';
      programType: 'ready' | 'custom';
      workoutTemplateId: string;
      sessionId: string;
    }
  | {
      tab: 'workout';
      screen: 'empty';
    }
  | {
      tab: 'workout';
      screen: 'template';
      workoutTemplateId?: string;
    }
  /** The short courses, listed. */
  | {
      tab: 'workout';
      screen: 'learn';
    }
  /** One course: its lifts, in the order they are easiest to learn. */
  | {
      tab: 'workout';
      screen: 'collection';
      collectionId: string;
    }
  | {
      tab: 'workout';
      screen: 'guided';
      workoutTemplateId: string;
      /**
       * Arrived by pressing something that said "resume", so the player opens
       * on the set rather than on the session overview.
       */
      resume?: boolean;
    }
  | {
      tab: 'workout';
      screen: 'summary';
    }
  | {
      tab: 'progress';
      screen: 'list';
      section?: 'overview' | 'records' | 'tracked' | 'measures';
      /**
       * Which measurement the measures section opens on. A Home stat card for
       * body fat used to open the section on whatever was selected last, and
       * the reader had to find body fat again to log it.
       */
      measure?: string;
      /**
       * Scroll the overview to a named block on arrival. The widget's
       * calendar tap lands here, and the calendar lives mid-page — arriving
       * at the top of the overview is arriving somewhere else (2026-08-25).
       */
      scrollTo?: 'activity';
      /**
       * When a notification tap opened this, in milliseconds. Two taps name
       * the same section and measure, which as bare values compare equal, so
       * the screen — which lets the reader move within it — never heard the
       * second one. A stamp that differs each time is what says "go there
       * again".
       */
      openedAt?: number;
    }
  | {
      tab: 'progress';
      screen: 'detail';
      exerciseKey: string;
    }
  | {
      tab: 'progress';
      screen: 'bodyweight';
    }
  | {
      tab: 'profile';
      screen: 'list';
    }
  | {
      tab: 'profile';
      screen: 'settings';
    }
  | {
      tab: 'profile';
      screen: 'my_data';
    }
  | {
      tab: 'profile';
      screen: 'export_plan';
    }
  | {
      tab: 'profile';
      screen: 'edit_profile';
    }
  | {
      tab: 'profile';
      screen: 'training_plan';
      /** Opens on the weekday editor — set when the week is still unknown. */
      editSchedule?: boolean;
    }
  | {
      tab: 'profile';
      screen: 'notifications';
    }
  | {
      tab: 'profile';
      screen: 'training_break';
    }
  | {
      tab: 'profile';
      /** Every reached milestone with its day, and every family's next one. */
      screen: 'milestones';
    }
  | {
      tab: 'profile';
      screen: 'subscription';
    }
  | {
      tab: 'profile';
      screen: 'membership_end';
    }
  | {
      tab: 'profile';
      screen: 'premium';
      /**
       * Why the reader is here. The paywall sold automated progression to
       * someone who had just been stopped by the programme cap and said
       * nothing about programmes, so the moment that opened it now travels
       * with the route.
       */
      reason?: 'program_cap';
    }
  | {
      tab: 'profile';
      screen: 'premium_unlock';
      /**
       * Which package the reader picked on the paywall. Carried here because
       * nothing else knows: there is no billing to ask, and the paywall's
       * selection is local state that dies with the screen.
       */
      plan?: 'monthly' | 'yearly' | 'lifetime';
      /**
       * Set when the press started the free trial rather than a purchase: the
       * ISO instant the trial ends. Carried for the same reason as `plan` —
       * the preferences write is still on its way when this screen draws its
       * first frame, and that frame must not print a renewal price.
       */
      trialUntil?: string;
    }
  | {
      tab: 'profile';
      screen: 'legal';
      /** Privacy policy or terms — same screen, same source data. */
      document: 'privacy' | 'terms';
    }
  | {
      tab: 'profile';
      screen: 'setup';
      /**
       * Questionnaire entry point: 'avoid' jumps straight to the limitations
       * step (My data), 'location' re-runs the whole flow for a fresh plan.
       * Absent = edit mode's default (review overview).
       */
      stage?: 'location' | 'avoid';
    };

export const ROOT_ROUTES: Record<RootTabKey, AppRoute> = {
  home: { tab: 'home', screen: 'dashboard' },
  workout: { tab: 'workout', screen: 'list' },
  progress: { tab: 'progress', screen: 'list' },
  profile: { tab: 'profile', screen: 'list' },
};

export const WORKOUT_PLAN_ROUTE: AppRoute = { tab: 'workout', screen: 'plans' };
