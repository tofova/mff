import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, MapPin, Headset, MessageSquarePlus, Clock, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function ContactPage() {
  return (
    <div className="ffi-clear bg-background">
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold font-headline text-primary mb-6 text-center">
            Contact Us
          </h1>
          <p className="text-lg text-muted-foreground mb-12 text-center">
            We're here to help. Reach out to us with any questions or concerns.
          </p>

          {/* Live Support / Garena Support highlight section */}
          <Card className="mb-12 overflow-hidden border-primary/20">
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="bg-[#075E54] text-white p-8 flex flex-col justify-center">
                <div className="flex items-center gap-3 mb-4">
                  <div className="relative h-14 w-14 rounded-full bg-white flex items-center justify-center overflow-hidden">
                    <Image src="/img/garena.png" alt="Garena" width={40} height={40} className="object-contain" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-2xl font-bold font-headline">Garena Support</span>
                      <Image src="/img/bluetick.gif" alt="Verified" width={22} height={22} className="h-5 w-5" />
                    </div>
                    <span className="text-sm text-white/80">Official Live Chat</span>
                  </div>
                </div>
                <p className="text-white/90 text-sm leading-relaxed">
                  Need quick help with an order, payment, or your Free Fire ID? Open a support report
                  and chat directly with our team. You'll get replies right inside the app — just like
                  messaging on WhatsApp.
                </p>
              </div>

              <CardContent className="p-8 flex flex-col justify-center">
                <ul className="space-y-4 mb-6">
                  <li className="flex items-start gap-3">
                    <div className="bg-primary/10 p-2 rounded-full mt-0.5">
                      <MessageSquarePlus className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">Create a Report</p>
                      <p className="text-sm text-muted-foreground">Describe your issue and send it in seconds.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="bg-primary/10 p-2 rounded-full mt-0.5">
                      <Headset className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">Chat with our Team</p>
                      <p className="text-sm text-muted-foreground">Get personal replies in a real-time chat.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="bg-primary/10 p-2 rounded-full mt-0.5">
                      <ShieldCheck className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">Track Your Reports</p>
                      <p className="text-sm text-muted-foreground">All your conversations stay saved in one place.</p>
                    </div>
                  </li>
                </ul>
                <Button asChild size="lg" className="w-full">
                  <Link href="/support">
                    <Headset className="h-5 w-5 mr-2" />
                    Open Garena Support
                  </Link>
                </Button>
              </CardContent>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="text-center">
              <CardHeader>
                <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit">
                  <Mail className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="font-headline mt-4">Email Support</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">For any support queries, please email us. We aim to respond within 24 hours.</p>
                <a href="mailto:garenaffmaxstore@gmail.com" className="text-primary font-semibold text-lg mt-2 inline-block hover:underline">
                  garenaffmaxstore@gmail.com
                </a>
              </CardContent>
            </Card>

            <Card className="text-center">
              <CardHeader>
                <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit">
                  <Clock className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="font-headline mt-4">Support Hours</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Our live chat support team is available to assist you.</p>
                <p className="font-semibold text-lg mt-2">
                  Mon – Sun, 9 AM – 9 PM (IST)
                </p>
              </CardContent>
            </Card>

            <Card className="text-center">
              <CardHeader>
                <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit">
                  <MapPin className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="font-headline mt-4">Headquarters</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">While we primarily offer digital services, you can find our corporate office here.</p>
                <p className="font-semibold text-lg mt-2">
                  Garena, Singapore
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
