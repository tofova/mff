'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { addCoinsToUser } from '@/app/actions';
import { Loader2 } from 'lucide-react';
import SendToAllUsersCard from './_components/send-to-all-users-card';

export default function CoinManagementPage() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);

    const formData = new FormData(event.currentTarget);
    const gamingId = formData.get('gamingId') as string;
    const amount = Number(formData.get('amount'));

    const result = await addCoinsToUser(gamingId, amount);

    if (result.success) {
      toast({ title: 'Success', description: result.message });
      (event.target as HTMLFormElement).reset();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }

    setIsLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Coin Management</CardTitle>
          <CardDescription>
            Add coins to a user's account by entering their Gaming ID.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="gamingId">User's Gaming ID</Label>
              <Input id="gamingId" name="gamingId" required placeholder="Enter Gaming ID" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount of Coins to Add</Label>
              <Input id="amount" name="amount" type="number" required min="1" placeholder="e.g., 100" />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoading ? 'Adding Coins...' : 'Add Coins'}
            </Button>
          </form>
        </CardContent>
      </Card>
      <SendToAllUsersCard />
    </div>
  );
}
