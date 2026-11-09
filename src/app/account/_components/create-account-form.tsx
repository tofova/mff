'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { createAccount } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CardContent, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { PasswordInput } from './password-input';
import { track } from '@/lib/analytics/posthog-client';
import { AnalyticsEvents } from '@/lib/analytics/events';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Creating Account...' : 'Create Account'}
    </Button>
  );
}

export default function CreateAccountForm() {
  const initialState = { message: '', success: false };
  const [state, dispatch] = useActionState(createAccount, initialState);
  const { toast } = useToast();

  useEffect(() => {
    if (state.message && !state.success) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: state.message,
      });
      track(AnalyticsEvents.accountCreateFailed, { reason: state.message });
    }
    if (state.message && state.success) {
        toast({
          title: 'Success',
          description: state.message,
        });
        track(AnalyticsEvents.accountCreated);
      }
  }, [state, toast]);

  return (
    <form action={dispatch}>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input id="username" name="username" required minLength={3} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" name="password" required minLength={6} />
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Important</AlertTitle>
          <AlertDescription>
            If you forget your username or password, there is no way to recover your account. If you lose access, please{' '}
            <Link href="/contact" className="font-semibold underline hover:text-destructive/80">
              contact us
            </Link> immediately.
          </AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter>
        <SubmitButton />
      </CardFooter>
    </form>
  );
}
