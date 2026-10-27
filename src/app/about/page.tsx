export default function AboutPage() {
  return (
    <div className="ffi-clear bg-background">
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold font-headline text-primary mb-6 text-center">
            About Garena
          </h1>
          <p className="text-lg text-muted-foreground mb-8 text-center">
            The official, secure, and trusted destination for discounted Free Fire items.
          </p>

          <div className="prose prose-lg max-w-none text-foreground space-y-6">
            <p>
              Welcome to <strong>Garena</strong>, the premier online shop for Free Fire players worldwide. As an official venture of Garena, headquartered in the vibrant tech hub of Singapore, we are dedicated to enhancing your gaming experience by providing a seamless and secure platform to purchase in-game items at unbeatable prices. With sub-offices in major continents, our global presence allows us to serve our diverse community effectively.
            </p>
            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">Our Mission</h2>
            <p>
              Our mission is simple: to make premium Free Fire content accessible to every player. We believe that everyone deserves to enjoy the full richness of the game, and we achieve this by offering significant discounts. How do we do it? We've integrated a unique model where displaying ads on our site helps subsidize the cost of gaming items, passing the savings directly on to you, our valued community.
            </p>
            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">Why Choose Us?</h2>
            <ul className="list-disc list-outside space-y-2 pl-6">
              <li>
                <strong>Official &amp; Trusted:</strong> As the official website of Garena, we guarantee that every transaction is secure and every item is legitimate. Your account's safety is our top priority.
              </li>
              <li>
                <strong>Global Access:</strong> No matter which region you play in, Garena is your global gateway to top-ups. We cater to players from all corners of the world.
              </li>
              <li>
                <strong>Flexible Payment Options:</strong> We offer multiple ways to top up. Pay directly for instant delivery of items to your game account, or use a redeem code for great value. Please note that redeem code processing can take up to one hour.
              </li>
              <li>
                <strong>Rewarding Referrals:</strong> We believe in the power of community. Our referral system rewards you for spreading the word. When you refer someone and they make a purchase, you receive 50% of their top-up amount as a bonus!
              </li>
            </ul>
            <p className="!mt-8">
              Thank you for choosing Garena. We are committed to serving the Free Fire community with integrity and passion. Gear up, and we'll see you in the game!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

    