
import ImageSlider from '@/components/image-slider';
import FaqChatbot from '@/components/faq-chatbot';
import { getProducts, getUserData, getOrdersForUser, getUserProductControls } from './actions';
import { type Metadata } from 'next';
import { type Product, type User, type Order, type UserProductControl, type SliderImage } from '@/lib/definitions';
import CoinSystem from '@/components/coin-system';
import { ObjectId } from 'mongodb';
import ProductList from '@/components/product-list';
import { getSliderImages } from './admin/(protected)/slider-management/actions';
import { isFfIndiaThemeActive } from '@/lib/ff-india-theme';


const baseMetadata: Metadata = {
  metadataBase: new URL('https://www.garenafreefire.store'),
  title: 'Garena Store - Free Fire Top-Up & Diamonds',
  description: 'The official, secure, and trusted Garena store for discounted Free Fire diamonds, memberships, and top-ups. Get unbeatable prices on in-game items for Free Fire MAX.',
  keywords: [
    'Free Fire top up', 'Free Fire MAX top up', 'Garena', 'Free Fire diamonds', 'top-up', 'garena free fire store', 'Garena free fire store', 'garenaff store', 'garenaff', 'in-game items', 'Garena Gears', 'buy Free Fire diamonds', 'Free Fire recharge', 'Garena top up center', 'Free Fire membership', 'cheap Free Fire diamonds', 'how to top up Free Fire', 'Garena Free Fire', 'diamonds for Free Fire', 'game top up', 'Free Fire redeem code', 'Garena topup', 'FF top up',
  ],
  openGraph: {
    title: 'Garena Store - Free Fire Top-Up & Diamonds',
    description: 'The official, secure, and trusted Garena store for discounted Free Fire diamonds and top-ups.',
    images: '/img/slider1.png'
  }
};

// While the Free Fire India launch theme is active the tab title mentions the launch;
// afterwards it is exactly the title above again.
export function generateMetadata(): Metadata {
  if (!isFfIndiaThemeActive()) return baseMetadata;
  return { ...baseMetadata, title: 'Garena Store - Free Fire India Launch | Top-Up & Diamonds' };
}


export default async function Home() {
  const products: (Product & { _id: ObjectId | string })[] = await getProducts();
  const user: User | null = await getUserData();
  const orders: Order[] = user ? await getOrdersForUser() : [];
  const controls: UserProductControl[] = user ? await getUserProductControls(user.gamingId) : [];
  const sliderImages: SliderImage[] = await getSliderImages();


  const productsWithStringId = products.map(p => ({...p, _id: p._id.toString()}));

  return (
    <div className="flex flex-col">
      <ImageSlider sliderImages={sliderImages} />
      <CoinSystem user={user} />
      <ProductList 
        initialProducts={productsWithStringId} 
        initialUser={user} 
        initialOrders={orders} 
        initialControls={controls} 
      />
      <FaqChatbot />
    </div>
  );
}
